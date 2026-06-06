import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';

const app = express();
// API Gateway 3001 portuna yönlendirme yapıyor
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- Doğru PostgreSQL Bağlantı Havuzu (Senin Ayarların) ---
const pool = new Pool({
    user: process.env.DB_USER || 'admin',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'userprofile_db',
    password: process.env.DB_PASSWORD || 'password123', // Güvenlik için fallback eklendi
    port: parseInt(process.env.DB_PORT || '5433', 10), // 5433 Portu
});

// Veritabanı bağlantı kontrolü ve Tablo oluşturma
// Veritabanı bağlantı kontrolü ve Tablo oluşturma
const initDB = async () => {
    try {
        await pool.connect();
        console.log('PostgreSQL database connected successfully');
        
        // ÖNEMLİ: Hatalı UUID tipli tabloyu silip yerine VARCHAR tipli yenisini kuruyoruz
        await pool.query('DROP TABLE IF EXISTS users CASCADE;');
        
        // Kullanıcılar tablosunu oluştur
        const queryText = `
            CREATE TABLE users (
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

const router = express.Router();

// 1. KULLANICI OLUŞTUR (Create)
router.post('/', async (req, res) => {
    const { display_name, email } = req.body;
    // Zero-Trust: API Gateway'den gelen kimliği al
    const userId = req.headers['x-user-uuid'] as string;

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: No User UUID provided' });
    }

    try {
        const query = `
            INSERT INTO users (id, display_name, email)
            VALUES ($1, $2, $3)
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, display_name, email]);
        res.status(201).json({ message: "User created successfully", user: result.rows[0] });
    } catch (err: any) {
        console.error('[User Profile] Insert Error:', err);
        if (err.code === '23505') { // PostgreSQL Unique Constraint İhlali
            return res.status(409).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 2. KULLANICI BİLGİSİNİ GETİR (Read)
router.get('/', async (req, res) => {
    const userId = req.headers['x-user-uuid'] as string;
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 3. KULLANICI BİLGİSİNİ GÜNCELLE (Update)
router.put('/', async (req, res) => {
    const userId = req.headers['x-user-uuid'] as string;
    const { display_name, email } = req.body;

    try {
        const query = `
            UPDATE users
            SET display_name = COALESCE($1, display_name),
                email = COALESCE($2, email)
            WHERE id = $3
            RETURNING *;
        `;
        const result = await pool.query(query, [display_name, email, userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: "User updated successfully", user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.use('/', router);

// Senin orijinal sağlık endpoint'in (Kök dizin)
app.get('/', (req, res) => {
    const userUuid = req.headers['x-user-uuid'];
    res.status(200).json({ 
        message: 'User Profile Service is running',
        authenticatedUser: userUuid || 'No authenticated user UUID received'
    });
});

app.listen(PORT, () => {
    console.log(`User Profile Service started on http://localhost:${PORT}`);
});