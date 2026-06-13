import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { verifyToken } from './middlewares/auth';
import jwt from 'jsonwebtoken';
import client from 'prom-client';

const app = express();
const PORT = 3000;

app.use(cors());

// YALNIZCA GELİŞTİRME İÇİN: Bize testlerimizde kullanmak üzere JWT üreten endpoint
app.post('/api/auth/dev-token', express.json(), (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'Lütfen test için bir userId gönderin' });
    }

    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
        return res.status(500).json({ error: 'Sunucuda JWT_SECRET eksik!' });
    }

    // Gönderdiğimiz userId ile imzalanmış, 1 gün geçerli gerçek bir token üretiyoruz
    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '1d' });

    res.json({
        message: "Test token'i basariyla uretildi",
        token: token
    });
});
// --- PROMETHEUS METRİKLERİ BAŞLATMA ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// Yönlendirme (Routing) Tanımlamaları

// 1. User Profile Service Yönlendirmesi
app.use('/api/users', createProxyMiddleware({
    target: 'http://user-profile-service:3001',
    changeOrigin: true
}));

app.use('/api/interactions', createProxyMiddleware({
    target: 'http://interaction-ingestion:3002',
    changeOrigin: true
}));

app.use('/api/feed', createProxyMiddleware({
    target: 'http://feed-recommendation-service:3003',
    changeOrigin: true
}));

// Healthcheck Endpoint'i
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'API Gateway is running' });
});

// --- PROMETHEUS UÇ NOKTASI (Her zaman listen'dan hemen önce) ---
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

app.listen(PORT, () => {
    console.log(`API Gateway started on http://localhost:${PORT}`);
});