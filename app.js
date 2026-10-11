require('dotenv').config();
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./db');
const locales = require('./locales');
const ai = require('./lib/ai');
const { validatePublicUrl } = require('./lib/network');

function createApp({ database = db, complete = ai.complete, sessionStore } = {}) {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        throw new Error('SESSION_SECRET must contain at least 32 characters.');
    }
    const app = express();
    app.disable('x-powered-by');
    if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'views'));
    app.use(helmet({ contentSecurityPolicy: { directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
        imgSrc: ["'self'", 'https:', 'data:'], upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    } } }));
    app.get('/health', (req, res) => res.json({ status: 'ok' }));
    app.use(express.urlencoded({ extended: true, limit: '100kb' }));
    app.use(express.json({ limit: '100kb' }));
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(session({
        name: 'ai-writer.sid', secret: process.env.SESSION_SECRET, store: sessionStore,
        resave: false, saveUninitialized: false,
        cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax', maxAge: 86400000 }
    }));
    app.use((req, res, next) => {
        req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
        res.locals.csrfToken = req.session.csrfToken;
        res.locals.signedIn = Boolean(req.session.userId);
        res.locals.language = ai.normalizeLanguage(req.query.lang || req.body.language);
        if (req.method === 'POST' && req.body._csrf !== req.session.csrfToken && req.get('x-csrf-token') !== req.session.csrfToken) {
            return res.status(403).render('error', { message: 'Your session expired. Reload the page and try again.' });
        }
        next();
    });
    const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    const authenticated = (req, res, next) => req.session.userId ? next() : res.redirect('/login');
    const expensiveLimit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });
    const loginLimit = rateLimit({ windowMs: 900000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
    // Reserve credits atomically so parallel requests cannot spend the same balance.
    async function withCredit(userId, operation) {
        const result = await database.query('UPDATE users SET credits = credits - 1, last_updated = NOW() WHERE id = ? AND credits > 0', [userId]);
        if (!result.affectedRows) { const error = new Error('You have no credits remaining.'); error.status = 403; throw error; }
        try { return await operation(); }
        catch (error) { await database.query('UPDATE users SET credits = credits + 1 WHERE id = ?', [userId]); throw error; }
    }
    app.get('/', wrap(async (req, res) => {
        let credits = null;
        if (req.session.userId) {
            const rows = await database.query('SELECT credits FROM users WHERE id = ?', [req.session.userId]);
            credits = rows[0]?.credits ?? 0;
        }
        res.render('index', { translations: locales[res.locals.language] || locales.en, credits });
    }));
    app.get('/login', (req, res) => res.render('login', { errorMessage: req.query.errorMessage || '', successMessage: req.query.successMessage || '' }));
    app.get('/register', (req, res) => res.render('register', { errorMessage: req.query.errorMessage || '' }));
    app.post('/register', loginLimit, wrap(async (req, res) => {
        const { username, password, email } = req.body;
        if (typeof username !== 'string' || !/^[\w.-]{3,50}$/.test(username) || typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72 || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).render('register', { errorMessage: 'Use a 3–50 character username, valid email and a password of 12–72 bytes.' });
        }
        try {
            await database.query('INSERT INTO users (username, password, email) VALUES (?, ?, ?)', [username, await bcrypt.hash(password, 12), email]);
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') return res.status(409).render('register', { errorMessage: 'That username or email is already registered.' });
            throw error;
        }
        res.redirect('/login?successMessage=Account%20created.%20Please%20sign%20in.');
    }));
    app.post('/login', loginLimit, wrap(async (req, res) => {
        const { username, password } = req.body;
        if (typeof username !== 'string' || typeof password !== 'string' || password.length > 200 || username.length > 50) return res.status(400).render('login', { errorMessage: 'Enter a username and password.', successMessage: '' });
        const rows = await database.query('SELECT id, password FROM users WHERE username = ?', [username]);
        if (!rows[0] || !await bcrypt.compare(password, rows[0].password)) return res.status(401).render('login', { errorMessage: 'Invalid username or password.', successMessage: '' });
        await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
        req.session.userId = rows[0].id;
        await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        res.redirect('/');
    }));
    app.post('/logout', wrap(async (req, res) => {
        await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
        res.clearCookie('ai-writer.sid'); res.redirect('/login');
    }));
    app.post('/process', authenticated, expensiveLimit, wrap(async (req, res) => {
        const language = ai.normalizeLanguage(req.body.language);
        let imageUrls = req.body.imageUrls;
        if (typeof imageUrls === 'string') imageUrls = [imageUrls];
        if (!Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 8 || imageUrls.some(url => typeof url !== 'string')) {
            return res.status(400).render('error', { message: 'Provide between one and eight image URLs.' });
        }
        try { imageUrls = await Promise.all(imageUrls.map(validatePublicUrl)); }
        catch { return res.status(400).render('error', { message: 'Use valid public HTTPS image URLs.' }); }
        const description = await withCredit(req.session.userId, () => complete(ai.descriptionMessages(imageUrls, language)));
        res.render('product', { imageUrls, description, language });
    }));
    app.post('/translate', authenticated, expensiveLimit, wrap(async (req, res) => {
        const { description } = req.body;
        if (typeof description !== 'string' || !description.trim() || description.length > 12000) return res.status(400).send('Provide text of up to 12,000 characters.');
        const language = ai.normalizeLanguage(req.body.language);
        const text = await withCredit(req.session.userId, () => complete([
            { role: 'system', content: `Translate the supplied text into ${ai.languages[language]}. Return only the translation; preserve its structure.` },
            { role: 'user', content: description }
        ]));
        res.type('text').send(text);
    }));
    app.get('/fetch_images', authenticated, expensiveLimit, wrap(async (req, res) => {
        let browser;
        try {
            const sourceUrl = await validatePublicUrl(req.query.sourceUrl);
            browser = await require('puppeteer').launch({ headless: true });
            const page = await browser.newPage();
            await page.setRequestInterception(true);
            page.on('request', request => {
                // Validate every request, including redirects and embedded resources.
                validatePublicUrl(request.url()).then(() => request.continue()).catch(() => request.abort()).catch(() => {});
            });
            await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 20000 });
            const candidates = await page.evaluate(() => [...new Set(Array.from(document.images, img => img.currentSrc || img.src))].slice(0, 40));
            const imageUrls = [];
            for (const url of candidates) {
                try { imageUrls.push(await validatePublicUrl(url)); } catch { /* Ignore local and invalid images. */ }
                if (imageUrls.length === 8) break;
            }
            res.json({ imageUrls });
        } catch { res.status(400).json({ error: 'Images could not be fetched. Check the URL or paste image links directly.' }); }
        finally { if (browser) await browser.close().catch(() => {}); }
    }));
    // Keep the legacy page URL useful while the editor becomes the single photo workflow.
    app.get('/fetch_product_photos', authenticated, (req, res) => res.redirect('/'));
    app.use('/youtube', authenticated, expensiveLimit, require('./youtube')({ complete, withCredit, wrap }));
    app.use((req, res) => res.status(404).render('error', { message: 'This page could not be found.' }));
    app.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('Request failed:', error.code || error.name); // Never log API request headers or credentials.
        const status = error.status || 500;
        res.status(status).render('error', { message: status < 500 ? error.message : 'The request could not be completed. Please try again later.' });
    });
    return app;
}

if (require.main === module) {
    for (const key of ['OPENAI_API_KEY', 'DB_USER', 'DB_NAME']) {
        if (!process.env[key]) throw new Error(`${key} is required. Copy .env.example to .env and configure it.`);
    }
    const MySQLStore = require('express-mysql-session')(session);
    const store = new MySQLStore(db.options);
    const app = createApp({ sessionStore: store });
    const server = app.listen(process.env.PORT || 3000, () => console.log('AI Writer is ready.'));
    const shutdown = () => server.close(() => { store.close(); db.close().finally(() => process.exit(0)); });
    process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
module.exports = { createApp };
