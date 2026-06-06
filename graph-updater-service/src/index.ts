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
const INTERACTION_QUEUE = 'interaction_events';
const SAGA_EXCHANGE = 'saga_events';
const SAGA_QUEUE = 'saga_user_creation_queue';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password123';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// --- İSTEMCİLERİ BAŞLAT ---
const neo4jDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// --- SAGA PATTERN: NEO4J KULLANICI DÜĞÜMÜ (NODE) OLUŞTURMA ---
async function createNeo4jUserNode(userId: string, displayName: string) {
    const session = neo4jDriver.session();
    try {
        const query = `
            MERGE (u:User {id: $userId})
            SET u.name = $displayName, u.created_at = timestamp()
            RETURN u
        `;
        await session.run(query, { userId, displayName });
        console.log(`[Neo4j] Saga tamamlandi: Baslangic Dugumu (Node) olusturuldu -> ${userId} (${displayName})`);
    } catch (error) {
        console.error('[Neo4j] Dugum olusturma hatasi (Saga basarisiz):', error);
    } finally {
        await session.close();
    }
}

// --- FATIGUE PENALTY & DIW ALGORİTMASI ---
async function processInteraction(userId: string, category: string, action: string) {
    const session = neo4jDriver.session();
    try {
        let weightDelta = 0;

        if (action === 'click' || action === 'like') {
            weightDelta = 0.1; 
        } 
        else if (action === 'impression') {
            const cacheKey = `impression:${userId}:${category}`;
            await redisClient.setEx(cacheKey, 60, 'true');
            console.log(`[Algoritma] Goruntuleme (Impression) hafizaya alindi: ${userId} -> ${category}`);
            return; 
        } 
        else if (action === 'skip') {
            const cacheKey = `impression:${userId}:${category}`;
            const hadImpression = await redisClient.get(cacheKey);

            if (hadImpression) {
                weightDelta = -0.2; 
                await redisClient.del(cacheKey); 
                console.log(`[FATIGUE PENALTY] Devrede! Kullanici (${userId}) ${category} kategorisini gorup hemen gecti. Agir ceza kesiliyor.`);
            } else {
                weightDelta = -0.05;
            }
        }

        if (weightDelta === 0) return;

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
        
        console.log(`[Neo4j] Kullanici: ${userId} | Kategori: ${category} | Yeni Agirlik: ${newWeight}`);
    } catch (error) {
        console.error('[Neo4j] Agirlik guncelleme hatasi:', error);
    } finally {
        await session.close();
    }
}

// --- RABBITMQ DİNLEYİCİSİ (HEM ETKİLEŞİM HEM SAGA) ---
async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        // 1. Etkileşim Kuyruğunu Dinle (Interaction Events)
        await channel.assertQueue(INTERACTION_QUEUE, { durable: true });
        console.log(`RabbitMQ listening on queue: ${INTERACTION_QUEUE}`);

        channel.consume(INTERACTION_QUEUE, async (msg) => {
            if (msg !== null) {
                try {
                    const eventData = JSON.parse(msg.content.toString());
                    if (eventData.userId && eventData.category && eventData.action) {
                        await processInteraction(eventData.userId, eventData.category, eventData.action);
                    }
                } catch (err) {
                    console.error('[!] Mesaj islenemedi:', err);
                }
                channel.ack(msg);
            }
        });

        // 2. Saga Pattern Kuyruğunu Dinle (User Creation Events)
        await channel.assertExchange(SAGA_EXCHANGE, 'topic', { durable: true });
        await channel.assertQueue(SAGA_QUEUE, { durable: true });
        await channel.bindQueue(SAGA_QUEUE, SAGA_EXCHANGE, 'user.created');
        console.log(`RabbitMQ listening for Saga events on queue: ${SAGA_QUEUE}`);

        channel.consume(SAGA_QUEUE, async (msg) => {
            if (msg !== null) {
                try {
                    const eventData = JSON.parse(msg.content.toString());
                    if (eventData.eventType === 'UserCreated') {
                        console.log(`[Saga Consumer] RabbitMQ'dan UserCreated eventi yakalandi: ${eventData.userId}`);
                        await createNeo4jUserNode(eventData.userId, eventData.displayName);
                    }
                } catch (err) {
                    console.error('[!] Saga mesaji islenemedi:', err);
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
    res.status(200).json({ status: 'Graph Updater Service is running with Saga Consumer' });
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