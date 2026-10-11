require('dotenv').config();
const mysql = require('mysql2/promise');
const options = {
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'ai_writer',
    port: Number(process.env.DB_PORT || 3306),
    waitForConnections: true, connectionLimit: 10, queueLimit: 0
};
const pool = mysql.createPool(options);
module.exports = {
    pool, options,
    query: async (sql, params) => { const [rows] = await pool.execute(sql, params); return rows; },
    close: () => pool.end()
};
