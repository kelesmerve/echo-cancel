import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import amqp from 'amqplib';
import neo4j from 'neo4j-driver';
import { createClient } from 'redis';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) + 4 : 3004;

// --- BAĞLANTI DEĞİŞKENLERİ ---
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';
const QUEUE_NAME = 'interaction_events';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password123';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// --- İSTEMCİLERİ BAŞLAT ---
const neo4jDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// --- FATIGUE PENALTY & DIW ALGORİTMASI ---
async function processInteraction(userId: string, category: string, action: string) {
    const session = neo4jDriver.session();
    try {
        let weightDelta = 0;

        if (action === 'click' || action === 'like') {
            weightDelta = 0.1; // Pozitif ilgi
        } 
        else if (action === 'impression') {
            // Sadece gördü. 60 saniyelik bir "hafıza" oluşturuyoruz.
            const cacheKey = `impression:${userId}:${category}`;
            await redisClient.setEx(cacheKey, 60, 'true');
            console.log(`[Algoritma] Görüntüleme (Impression) hafızaya alındı: ${userId} -> ${category}`);
            return; // DB'ye yazmadan çıkıyoruz
        } 
        else if (action === 'skip') {
            // Geçme eylemi. Acaba hemen öncesinde gördü mü?
            const cacheKey = `impression:${userId}:${category}`;
            const hadImpression = await redisClient.get(cacheKey);

            if (hadImpression) {
                // FATIGUE PENALTY SCORE DEVREDE! (Gördü ve hemen geçti)
                weightDelta = -0.2; 
                await redisClient.del(cacheKey); // Hafızayı temizle
                console.log(`[⚡ FATIGUE PENALTY] Devrede! Kullanıcı (${userId}) ${category} kategorisini görüp hemen geçti. Ağır ceza kesiliyor.`);
            } else {
                // Sadece geçti (Normal ceza)
                weightDelta = -0.05;
            }
        }

        if (weightDelta === 0) return;

        // Neo4j Cypher Sorgusu ile Ağırlığı Güncelle
        const query = `
            MERGE (u:User {id: $userId})
            MERGE (c:Category {name: $category})
            MERGE (u)-[r:INTERESTED_IN]->(c)
            ON CREATE SET r.weight = 0.5 + $weightDelta
            ON MATCH SET r.weight = r.weight + $weightDelta
            RETURN r.weight as newWeight
        `;

        const result = await session.run(query, { userId, category, weightDelta });
        const newWeight = result.records[0]?.get('newWeight');
        
        console.log(`[Neo4j] Kullanıcı: ${userId} | Kategori: ${category} | Yeni Ağırlık: ${newWeight}`);
    } catch (error) {
        console.error('[Neo4j] Ağırlık güncelleme hatası:', error);
    } finally {
        await session.close();
    }
}

// --- RABBITMQ DİNLEYİCİSİ ---
async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log(`RabbitMQ connected. Listening for messages on queue: ${QUEUE_NAME}`);

        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                const messageContent = msg.content.toString();
                
                try {
                    const eventData = JSON.parse(messageContent);
                    if (eventData.userId && eventData.category && eventData.action) {
                        await processInteraction(eventData.userId, eventData.category, eventData.action);
                    }
                } catch (err) {
                    console.error('[!] Mesaj işlenemedi:', err);
                }
                channel.ack(msg);
            }
        });
    } catch (error) {
        console.error('RabbitMQ connection failed:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
}

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Graph Updater Service is running with Fatigue Penalty Algorithm' });
});

app.listen(PORT, async () => {
    console.log(`Graph Updater Service started on http://localhost:${PORT}`);
    
    try {
        await neo4jDriver.verifyConnectivity();
        console.log('Neo4j connected successfully.');
        await redisClient.connect();
        console.log('Redis connected successfully for caching.');
    } catch (err) {
        console.error('Database connection error:', err);
    }

    connectRabbitMQ();
});