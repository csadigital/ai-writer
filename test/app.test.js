process.env.SESSION_SECRET = 'test-only-session-secret-with-over-32-characters';
process.env.NODE_ENV = 'test';
process.env.DOTENV_CONFIG_QUIET = 'true';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { createApp } = require('../app');
const { isPublicAddress, validatePublicUrl } = require('../lib/network');
const { descriptionMessages, normalizeLanguage } = require('../lib/ai');
const db = require('../db');

test('public URL validation rejects local networks, credentials and unsafe schemes', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
    assert.equal(isPublicAddress('93.184.216.34'), true);
    for (const url of ['http://example.com/image.jpg', 'https://127.0.0.1/', 'https://[::1]/', 'file:///etc/passwd', 'https://user:pass@example.com/', 'https://example.com:8443/']) await assert.rejects(validatePublicUrl(url));
});

test('image prompts use valid content parts and normalize unsupported languages', () => {
    const messages = descriptionMessages(['https://example.com/image.jpg'], 'tr');
    assert.match(messages[0].content[0].text, /Turkish/);
    assert.equal(messages[0].content[1].type, 'image_url');
    assert.equal(normalizeLanguage('__proto__'), 'en');
});

test('account, image, translation and credit flows with isolated database and AI doubles', async t => {
    const password = await bcrypt.hash('a-secure-test-password', 4);
    let credits = 2, calls = 0, shouldFail = false;
    const database = { query: async (sql, args) => {
        if (sql.startsWith('SELECT id')) return args[0] === 'tester' ? [{ id: 1, password }] : [];
        if (sql.startsWith('SELECT credits')) return [{ credits }];
        if (sql.includes('credits = credits - 1')) { if (!credits) return { affectedRows: 0 }; credits--; return { affectedRows: 1 }; }
        if (sql.includes('credits = credits + 1')) { credits++; return { affectedRows: 1 }; }
        if (sql.startsWith('INSERT')) return { affectedRows: 1 };
        throw new Error('Unexpected query in test');
    } };
    const complete = async () => { calls++; if (shouldFail) throw new Error('Simulated upstream failure'); return 'A useful description <script>alert(1)</script>'; };
    const server = createApp({ database, complete }).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close(); });
    let cookie = '', csrf = '';
    async function get(url) {
        const response = await fetch(base + url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        const text = await response.text();
        csrf = text.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1] || csrf;
        return { response, text };
    }
    async function post(url, body, token = csrf) {
        const response = await fetch(base + url, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, _csrf: token }) });
        if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
        return { response, text: await response.text() };
    }
    const health = await fetch(base + '/health');
    assert.equal(health.status, 200); assert.equal(health.headers.get('set-cookie'), null);
    let result = await get('/'); assert.equal(result.response.status, 200); assert.match(result.text, /Good products/);
    for (const url of ['/login', '/register', '/?lang=tr']) assert.equal((await get(url)).response.status, 200);
    assert.equal((await get('/youtube')).response.status, 302);
    assert.equal((await post('/process', { 'imageUrls[]': 'https://93.184.216.34/a.jpg' })).response.status, 302);
    assert.equal((await post('/register', { username: 'x', email: 'bad', password: 'short' })).response.status, 400);
    assert.equal((await post('/register', { username: 'tester', email: 'test@example.com', password: 'a-secure-test-password' })).response.status, 302);
    assert.equal((await post('/login', { username: 'tester', password: 'wrong' })).response.status, 401);
    assert.equal((await post('/login', { username: 'tester', password: 'a-secure-test-password' }, 'invalid')).response.status, 403);
    const oldCookie = cookie;
    assert.equal((await post('/login', { username: 'tester', password: 'a-secure-test-password' })).response.status, 302);
    assert.notEqual(cookie, oldCookie, 'successful login rotates the session');
    await get('/');
    assert.equal((await get('/youtube')).response.status, 200);
    assert.equal((await post('/youtube/process', { youtube_url: '../../invalid' })).response.status, 400);
    assert.equal((await post('/process', {})).response.status, 400);
    assert.equal((await post('/process', { 'imageUrls[]': 'https://127.0.0.1/secret' })).response.status, 400);
    assert.equal(calls, 0);
    shouldFail = true;
    result = await post('/process', { 'imageUrls[]': 'https://93.184.216.34/photo.jpg', language: 'tr' });
    assert.equal(result.response.status, 500); assert.equal(credits, 2, 'failed generation is refunded');
    shouldFail = false;
    result = await post('/process', { 'imageUrls[]': 'https://93.184.216.34/photo.jpg', language: 'tr' });
    assert.equal(result.response.status, 200); assert.equal(credits, 1); assert.match(result.text, /&lt;script&gt;/); assert.doesNotMatch(result.text, /<script>alert/);
    assert.equal((await post('/translate', { description: 'Draft', language: 'de' })).response.status, 200); assert.equal(credits, 0);
    assert.equal((await post('/process', { 'imageUrls[]': 'https://93.184.216.34/photo.jpg' })).response.status, 403);
    credits = 1;
    const parallel = await Promise.all([post('/translate', { description: 'Draft', language: 'tr' }), post('/translate', { description: 'Draft', language: 'tr' })]);
    assert.deepEqual(parallel.map(result => result.response.status).sort(), [200, 403]); assert.equal(credits, 0);
    assert.equal((await post('/logout', {})).response.status, 302);
    assert.equal((await get('/youtube')).response.status, 302);
    assert.equal((await get('/missing')).response.status, 404);
});
