import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import amqp from 'amqplib';
import neo4j from 'neo4j-driver';
import { createClient } from 'redis';
import client from 'prom-client';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) + 4 : 3004;

// --- PROMETHEUS METRİKLERİ BAŞLATMA ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// --- BAĞLANTI DEĞİŞKENLERİ ---
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';
const INTERACTION_EXCHANGE = 'interaction_exchange';
const INTERACTION_QUEUE = 'graph_updater_interaction_queue';
const SAGA_EXCHANGE = 'saga_events';
const SAGA_QUEUE = 'saga_user_creation_queue';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password123';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';

// --- İSTEMCİLERİ BAŞLAT ---
const neo4jDriver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// Impression Cache için DB 1
const redisClient = createClient({ url: REDIS_URL });
redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// Yeni bir Redis Client oluştur (Feed Cache için DB 2)
const feedCacheClient = createClient({ url: process.env.FEED_CACHE_REDIS_URL || 'redis://localhost:6379/2' });
feedCacheClient.on('error', (err) => console.error('[Feed Cache Redis] Error:', err));

async function cacheUserFeed(userId: string) {
    const session = neo4jDriver.session();
    try {
        const query = `
            MATCH (u:User {id: $userId})-[r:INTERESTED_IN]->(c:Category)
            WITH c.name AS category, r.weight AS weight
            ORDER BY weight DESC
            LIMIT 2
            WITH collect({category: category, type: 'personalized', weight: weight}) AS personalizedItems

            MATCH (allCat:Category)
            WHERE NOT EXISTS {
                MATCH (u:User {id: $userId})-[r2:INTERESTED_IN]->(allCat)
                WHERE r2.weight > 0.5
            }
            WITH allCat.name AS category, rand() AS randomSort, personalizedItems
            ORDER BY randomSort
            LIMIT 1
            WITH personalizedItems, collect({category: category, type: 'discovery', weight: 'N/A'}) AS discoveryItems

            RETURN personalizedItems + discoveryItems AS feed
        `;

        const result = await session.run(query, { userId });
        const feed = result.records[0]?.get('feed') || [];

        await feedCacheClient.setEx(`feed:${userId}`, 600, JSON.stringify(feed));
        console.log(`[Cache] Kullanici (${userId}) feed'i onbellege alindi.`);
    } catch (error) {
        console.error('[Cache] Feed onbellege alinirken hata:', error);
    } finally {
        await session.close();
    }
}

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

async function deleteNeo4jUserNode(userId: string) {
    const session = neo4jDriver.session();
    try {
        const query = `
            MATCH (u:User {id: $userId})
            DETACH DELETE u
        `;
        await session.run(query, { userId });
        await feedCacheClient.del(`feed:${userId}`);
        console.log(`[Neo4j] Saga Telafisi tamamlandi: Kullanici (${userId}) ve tum baglari sistemden silindi.`);
    } catch (error) {
        console.error('[Neo4j] Dugum silme hatasi (Saga telafisi basarisiz):', error);
    } finally {
        await session.close();
    }
}

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

        // CASE ile Clamping uyguluyoruz: 0.0 - 1.0 arası sabit
        const query = `
            MERGE (u:User {id: $userId})
            MERGE (c:Category {name: $category})
            MERGE (u)-[r:INTERESTED_IN]->(c)
            SET r.weight = CASE 
                WHEN r.weight IS NULL THEN 
                    CASE 
                        WHEN 0.5 + $weightDelta > 1.0 THEN 1.0
                        WHEN 0.5 + $weightDelta < 0.0 THEN 0.0
                        ELSE 0.5 + $weightDelta
                    END
                ELSE 
                    CASE 
                        WHEN r.weight + $weightDelta > 1.0 THEN 1.0
                        WHEN r.weight + $weightDelta < 0.0 THEN 0.0
                        ELSE r.weight + $weightDelta
                    END
            END
            RETURN r.weight as newWeight
        `;

        const result = await session.run(query, { userId, category, weightDelta });
        const newWeight = result.records[0]?.get('newWeight');

        console.log(`[Neo4j] Kullanici: ${userId} | Kategori: ${category} | Yeni Agirlik: ${newWeight}`);

        // 2. Cache Invalidation: Etkileşim olduğu an önbelleği uçur!
        await feedCacheClient.del(`feed:${userId}`);
        console.log(`[Cache Invalidation] Feed temizlendi: feed:${userId}`);

    } catch (error) {
        console.error('[Neo4j] Agirlik guncelleme hatasi:', error);
    } finally {
        await session.close();
    }
}

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertExchange(INTERACTION_EXCHANGE, 'topic', { durable: true });
        const q = await channel.assertQueue(INTERACTION_QUEUE, { durable: true });
        await channel.bindQueue(q.queue, INTERACTION_EXCHANGE, 'interaction.new');
        console.log(`RabbitMQ listening on queue: ${q.queue} bound to ${INTERACTION_EXCHANGE}`);

        channel.consume(q.queue, async (msg) => {
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
                        await cacheUserFeed(eventData.userId);
                    } else if (eventData.eventType === 'UserDeleted') {
                        console.log(`[Saga Consumer] RabbitMQ'dan UserDeleted eventi yakalandi: ${eventData.userId}`);
                        await deleteNeo4jUserNode(eventData.userId);
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

// --- PROMETHEUS UÇ NOKTASI ---
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

app.listen(PORT, async () => {
    console.log(`Graph Updater Service started on http://localhost:${PORT}`);

    try {
        await neo4jDriver.verifyConnectivity();
        console.log('Neo4j connected successfully.');
        await redisClient.connect();
        await feedCacheClient.connect(); // DB 2 client'ı da başlatıyoruz
        console.log('Redis connected successfully for caching.');
    } catch (err) {
        console.error('Database connection error:', err);
    }

    connectRabbitMQ();
});