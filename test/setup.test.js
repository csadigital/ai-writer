const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildConfig, serializeConfig, provisionDatabase } = require('../scripts/setup');

test('setup generates fresh secrets and preserves saved credentials on repeat runs', () => {
    const initial = buildConfig({ OPENAI_API_KEY: 'test-key' });
    const second = buildConfig(initial);
    assert.ok(initial.SESSION_SECRET.length >= 32);
    assert.ok(initial.DB_PASSWORD.length >= 24);
    assert.equal(second.SESSION_SECRET, initial.SESSION_SECRET);
    assert.equal(second.DB_PASSWORD, initial.DB_PASSWORD);
    assert.notEqual(buildConfig().DB_PASSWORD, initial.DB_PASSWORD);
    assert.equal(second.OPENAI_API_KEY, 'test-key');
});

test('setup rejects SQL identifiers and invalid ports, and safely quotes env values', () => {
    assert.throws(() => buildConfig({ DB_NAME: 'writer; DROP TABLE users' }));
    assert.throws(() => buildConfig({ DB_USER: 'root@%' }));
    assert.throws(() => buildConfig({ DB_PORT: '70000' }));
    assert.throws(() => buildConfig({ PORT: '3000oops' }));
    const text = serializeConfig(buildConfig({ DB_PASSWORD: 'p#ss"word' }));
    assert.equal(require('dotenv').parse(text).DB_PASSWORD, 'p#ss"word');
    assert.throws(() => serializeConfig({ DB_PASSWORD: 'line\nbreak' }));
});

test('database setup scopes grants to the app database and parameterizes account credentials', async () => {
    const queries = [];
    const connection = { query: async (...args) => queries.push(args) };
    const mysql = { escapeId: value => '`' + value + '`' };
    const config = buildConfig();
    await provisionDatabase(connection, mysql, config, 'localhost');
    assert.equal(queries.length, 3);
    assert.match(queries[0][0], /CREATE DATABASE IF NOT EXISTS `ai_writer`/);
    assert.deepEqual(queries[1][1], ['ai_writer', 'localhost', config.DB_PASSWORD]);
    assert.match(queries[2][0], /ON `ai_writer`\.\* TO \?@\?/);
    assert.doesNotMatch(queries[2][0], /ALL PRIVILEGES|GRANT OPTION/);
    await assert.rejects(provisionDatabase(connection, mysql, config, 'bad\naccount'));
});
