import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { verifyToken } from './middlewares/auth';
import client from 'prom-client';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- PROMETHEUS METRİKLERİ BAŞLATMA ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// Yönlendirme (Routing) Tanımlamaları

// 1. User Profile Service Yönlendirmesi
app.use('/api/users', verifyToken, createProxyMiddleware({
    target: 'http://localhost:3001',
    changeOrigin: true,
}));

// 2. Interaction Ingestion Service Yönlendirmesi
app.use('/api/interactions', verifyToken, createProxyMiddleware({
    target: 'http://localhost:3002',
    changeOrigin: true,
    pathRewrite: { '^/api/interactions': '/' } // Go servisine sadece / olarak gitmesi için eklendi
}));

// 3. Feed Recommendation Service Yönlendirmesi
app.use('/api/feed', verifyToken, createProxyMiddleware({
    target: 'http://localhost:3003',
    changeOrigin: true,
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