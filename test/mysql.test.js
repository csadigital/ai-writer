const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { buildConfig, provisionDatabase } = require('../scripts/setup');

test('auto setup provisions a real MySQL user, schema and atomic credit balance', { skip: !process.env.MYSQL_TEST_HOST }, async () => {
    // Run only against the explicit, ephemeral CI service, never the application .env.
    const config = buildConfig({ DB_HOST: process.env.MYSQL_TEST_HOST, DB_PORT: process.env.MYSQL_TEST_PORT || '3306', DB_NAME: 'ai_writer_setup_test', DB_USER: 'ai_writer_setup_test' });
    const admin = await mysql.createConnection({ host: config.DB_HOST, port: Number(config.DB_PORT), user: 'root', password: process.env.MYSQL_TEST_ROOT_PASSWORD });
    let app;
    try {
        await provisionDatabase(admin, mysql, config, '%');
        app = await mysql.createConnection({ host: config.DB_HOST, port: Number(config.DB_PORT), user: config.DB_USER, password: config.DB_PASSWORD, database: config.DB_NAME });
        await app.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8').replace(/^--.*$/gm, '').trim());
        const [insert] = await app.execute('INSERT INTO users (username, email, password) VALUES (?, ?, ?)', ['setup_test', 'setup-test@example.com', 'not-a-real-password-hash']);
        const [initial] = await app.execute('SELECT credits FROM users WHERE id = ?', [insert.insertId]);
        assert.equal(initial[0].credits, 10);
        const results = await Promise.all(Array.from({ length: 15 }, () => app.execute('UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0', [insert.insertId])));
        assert.equal(results.reduce((total, [result]) => total + result.affectedRows, 0), 10);
        const [final] = await app.execute('SELECT credits FROM users WHERE id = ?', [insert.insertId]);
        assert.equal(final[0].credits, 0);
    } finally {
        if (app) await app.end();
        await admin.end();
    }
});
