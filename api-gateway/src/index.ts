import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { verifyToken } from './middlewares/auth';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

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

app.listen(PORT, () => {
    console.log(`API Gateway started on http://localhost:${PORT}`);
});