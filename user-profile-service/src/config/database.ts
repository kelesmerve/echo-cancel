import { Pool } from 'pg';

export const pool = new Pool({
    user: process.env.DB_USER || 'admin',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'userprofile_db',
    password: process.env.DB_PASSWORD || 'password123',
    port: parseInt(process.env.DB_PORT || '5434', 10),
});

export const initDB = async () => {
    try {
        const queryText = `
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                display_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS outbox_events (
                id SERIAL PRIMARY KEY,
                event_type VARCHAR(50) NOT NULL,
                payload JSONB NOT NULL,
                status VARCHAR(20) DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await pool.query(queryText);
        console.log('PostgreSQL: "users" and "outbox_events" tables are ready.');
    } catch (err: any) {
        console.error('PostgreSQL initialization error:', err.stack);
    }
};