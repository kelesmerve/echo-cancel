import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initDB } from './config/database'; // Tabloyu kuran dogru dosya
import { createUser, getUser, updateUser, deleteUser } from './controllers/userController';
import client from 'prom-client';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// --- PROMETHEUS METRİKLERİ BAŞLATMA ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// Veritabanı tablolarını (users ve outbox_events) olustur
initDB();

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

app.listen(PORT, () => {
    console.log(`User Profile Service API started on http://localhost:${PORT}`);
});