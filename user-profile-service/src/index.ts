import express from 'express';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
// API Gateway 3001 portuna yönlendirme yapıyor
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Docker Compose dosyamızdaki PostgreSQL bağlantı bilgileri
const pool = new Pool({
    user: process.env.DB_USER || 'admin',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'userprofile_db',
    password: process.env.DB_PASSWORD, 
    port: parseInt(process.env.DB_PORT || '5433', 10),
});

// Veritabanı bağlantı kontrolü
pool.connect()
    .then(() => console.log('PostgreSQL database connected successfully'))
    .catch(err => console.error('PostgreSQL connection error:', err.stack));

// Temel endpoint
app.get('/', (req, res) => {
    // Zero-Trust: API Gateway'in doğrulatıp eklediği x-user-uuid header'ını okuyoruz
    const userUuid = req.headers['x-user-uuid'];
    
    res.status(200).json({ 
        message: 'User Profile Service is running',
        authenticatedUser: userUuid || 'No authenticated user UUID received'
    });
});

app.listen(PORT, () => {
    console.log(`User Profile Service started on http://localhost:${PORT}`);
});