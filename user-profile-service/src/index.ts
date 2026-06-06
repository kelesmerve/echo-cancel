import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import amqp from 'amqplib';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- POSTGRESQL BAĞLANTISI ---
const pool = new Pool({
    user: process.env.DB_USER || 'admin',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'userprofile_db',
    password: process.env.DB_PASSWORD || 'password123',
    port: parseInt(process.env.DB_PORT || '5433', 10),
});

const initDB = async () => {
    try {
        await pool.connect();
        console.log('PostgreSQL database connected successfully');
        

        const queryText = `
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                display_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await pool.query(queryText);
        console.log('PostgreSQL "users" table is ready with VARCHAR id.');
    } catch (err: any) {
        console.error('PostgreSQL initialization error:', err.stack);
    }
};

initDB();

// --- RABBITMQ (SAGA PATTERN) BAĞLANTISI ---
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';
let rabbitChannel: amqp.Channel;

const connectRabbitMQ = async () => {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        rabbitChannel = await connection.createChannel();
        await rabbitChannel.assertExchange('saga_events', 'topic', { durable: true });
        console.log('RabbitMQ connected for Saga Pattern (Publisher)');
    } catch (error) {
        console.error('RabbitMQ connection failed:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
};

connectRabbitMQ();

// --- CRUD UÇ NOKTALARI ---
const router = express.Router();

// KULLANICI OLUŞTUR VE SAGA BAŞLAT
router.post('/', async (req, res) => {
    const { display_name, email } = req.body;
    const userId = req.headers['x-user-uuid'] as string;

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: No User UUID provided' });
    }

    try {
        // 1. Veritabanına Yaz (Local Transaction)
        const query = `
            INSERT INTO users (id, display_name, email)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, display_name, email]);

        // 2. SAGA PATTERN: RabbitMQ'ya Event Fırlat (Choreography)
        if (rabbitChannel) {
            const sagaEvent = {
                eventType: 'UserCreated',
                userId: userId,
                displayName: display_name,
                timestamp: new Date().toISOString()
            };
            
            // saga_events isimli exchange'e gönderiyoruz
            rabbitChannel.publish(
                'saga_events', 
                'user.created', 
                Buffer.from(JSON.stringify(sagaEvent))
            );
            console.log(`[Saga] UserCreated eventi firlatildi: ${userId}`);
        }

        res.status(201).json({ message: "User created and Saga initiated", user: result.rows[0] });
    } catch (err: any) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/', async (req, res) => {
    const userId = req.headers['x-user-uuid'] as string;
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.use('/', router);

app.listen(PORT, () => {
    console.log(`User Profile Service started on http://localhost:${PORT}`);
});