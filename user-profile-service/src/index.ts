import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initDB } from './config/database';
import { createUser, getUser, updateUser, deleteUser } from './controllers/userController';
import client from 'prom-client';

// Worker ve Consumer'ı içeri aktarıyoruz
import { startWorker } from './worker';
import { startConsumer } from './consumer';

const app = express();

// KRİTİK 1: Portu kesin olarak 3001'e sabitledik (Gateway ile çakışmayı önler)
const PORT = 3001;

app.use(cors());
app.use(express.json());

// --- PROMETHEUS METRİKLERİ BAŞLATMA ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// --- CLEAN ARCHITECTURE ROUTING ---
app.post('/', createUser);
app.get('/', getUser);
app.put('/', updateUser);
app.delete('/', deleteUser);

// --- PROMETHEUS UÇ NOKTASI ---
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

// --- BAŞLATMA SIRALAMASI (Senkronizasyon) ---
app.listen(PORT, async () => {
    console.log(`User Profile Service API started on http://localhost:${PORT}`);

    // 1. Önce Veritabanı Tabloları Kurulur
    await initDB();

    // 2. Tablolar hazır olduktan sonra Worker başlatılır
    console.log('Starting Outbox Worker...');
    startWorker();

    // 3. Saga Compensating Consumer'ı başlat
    console.log('Starting Compensating Consumer...');
    startConsumer();
});