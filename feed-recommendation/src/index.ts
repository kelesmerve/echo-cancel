import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import neo4j from 'neo4j-driver';
import cors from 'cors';
import { createClient } from 'redis';
import client from 'prom-client';

const app = express();
const PORT = process.env.FEED_RECOMMENDATION_PORT || 3003;

app.use(cors());
app.use(express.json());

// --- PROMETHEUS METRİKLERİ BAŞLATMA ---
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ register: client.register });

// --- REDIS BAĞLANTISI (CACHE İÇİN) ---
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/2';
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// --- NEO4J BAĞLANTISI (ALGORİTMA İÇİN) ---
const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password123';

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// Veritabanlarını Başlat
async function initDatabases() {
    try {
        await redisClient.connect();
        console.log('Redis (DB 2) connected for Feed Cache');

        await driver.verifyConnectivity();
        console.log('Neo4j database connected successfully for Feed Generation');
    } catch (error) {
        console.error('Database connection error:', error);
    }
}

initDatabases();

app.get('/health', (req, res) => {
    res.status(200).json({ message: 'Feed Recommendation Service is running with Redis & Neo4j' });
});

// --- ASIL ALGORİTMA: REDIS + NEO4J ---
app.get('/', async (req, res) => {
    const userId = req.headers['x-user-uuid'] as string;

    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: Missing user UUID' });
    }

    try {
        // 1. Önce Redis'ten Cache'i oku
        const cachedFeed = await redisClient.get(`feed:${userId}`);

        if (cachedFeed) {
            console.log(`[Cache Hit] Feed Redis'ten getirildi: ${userId}`);
            return res.json({
                userId,
                message: "Here is your echo-cancelled feed (from cache)",
                feed: JSON.parse(cachedFeed)
            });
        }

        // 2. Cache'te yoksa Neo4j'den hesapla
        console.log(`[Cache Miss] Feed Neo4j'den hesaplanıyor: ${userId}`);
        const session = driver.session();

        const query = `
            MATCH (u:User {id: $userId})-[r:INTERESTED_IN]->(c:Category)
            WITH c.name AS category, r.weight AS weight
            ORDER BY weight DESC
            LIMIT 2
            WITH collect({category: category, type: 'personalized', weight: weight}) AS personalizedItems

            MATCH (allCat:Category)
            WHERE NOT EXISTS {
                MATCH (u:User {id: $userId})-[r2:INTERESTED_IN]->(allCat)
            }
            WITH allCat.name AS category, rand() AS randomSort, personalizedItems
            ORDER BY randomSort
            LIMIT 1
            WITH personalizedItems, collect({category: category, type: 'discovery', weight: 'N/A'}) AS discoveryItems

            RETURN personalizedItems + discoveryItems AS feed
        `;

        const result = await session.run(query, { userId });
        await session.close();

        const feed = result.records[0]?.get('feed') || [];

        // 3. Hesaplanan feed'i Redis'e yaz (300 saniye / 5 dakika TTL ile)
        await redisClient.setEx(`feed:${userId}`, 300, JSON.stringify(feed));

        return res.json({
            userId,
            message: "Here is your echo-cancelled feed (generated and cached)",
            feed
        });

    } catch (error) {
        console.error('[Feed] Error fetching feed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- PROMETHEUS UÇ NOKTASI ---
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

app.listen(PORT, () => {
    console.log(`Feed Recommendation Service started on http://localhost:${PORT}`);
});