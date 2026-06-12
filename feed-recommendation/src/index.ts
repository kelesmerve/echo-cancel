import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import neo4j from 'neo4j-driver';
import cors from 'cors';
import { createClient } from 'redis';

const app = express();
const PORT = 3003; // .env'deki 3000'i ezmek için doğrudan 3003 verdik

app.use(cors());
app.use(express.json());

// Redis DB 2'ye bağlanıyoruz (Feed Cache)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/2';
const redisClient = createClient({ url: REDIS_URL });

redisClient.on('error', (err) => console.error('[Redis] Error:', err));

// Başlangıçta Redis'e bağlan
redisClient.connect().then(() => console.log('Redis (DB 2) connected for Feed Cache'));

app.get('/health', (req, res) => {
    res.status(200).json({ message: 'Feed Recommendation Service is running (Redis Cache)' });
});

app.get('/', async (req, res) => {
    // Güvenlik açığı kapatıldı: test-user fallback'i kaldırıldı
    const userId = req.headers['x-user-uuid'] as string;

    if (!userId) {
         return res.status(401).json({ error: 'Unauthorized: Missing user UUID' });
    }

    try {
        // 1. Önce Redis'ten Cache'i oku
        const cachedFeed = await redisClient.get(`feed:${userId}`);

        if (cachedFeed) {
            return res.json({
                userId,
                message: "Here is your echo-cancelled feed (from cache)",
                feed: JSON.parse(cachedFeed)
            });
        }

        // 2. Eğer Cache'te yoksa?
        // (İsteğe bağlı: Asenkron olarak Graph Updater'a bir mesaj atıp hesaplatabilirsiniz
        // veya varsayılan (default) bir feed döndürebilirsiniz.)
        return res.json({
            userId,
            message: "No personalized feed available yet. Showing default.",
            feed: [
                { category: "general", type: "default", weight: "N/A" }
            ]
        });

    } catch (error) {
        console.error('[Feed] Error fetching feed from cache:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Feed Recommendation Service started on http://localhost:${PORT}`);
});

// Docker Compose dosyamızdaki Neo4j bağlantı bilgileri
const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
        process.env.NEO4J_USER || 'neo4j', 
        process.env.NEO4J_PASSWORD || 'password123'
    )
);

// Veritabanı bağlantı kontrolü
driver.getServerInfo()
    .then(info => {
        console.log('Neo4j database connected successfully');
    })
    .catch(error => {
        console.error('Neo4j connection error:', error);
    });

// Sağlık kontrolü endpoint'i
app.get('/health', (req, res) => {
    res.status(200).json({ 
        message: 'Feed Recommendation Service is running'
    });
});

// Asıl Algoritma Endpoint'i (Kök dizinde çalışır)
app.get('/', async (req, res) => {
    // Zero-Trust: API Gateway'den gelen user UUID
    const userId = req.headers['x-user-uuid'] as string || 'test-user-uuid-1234';

    const session = driver.session();
    try {
        const query = `
            // Bölüm 1: Kişiselleştirilmiş (Favoriler)
            MATCH (u:User {id: $userId})-[r:INTERESTED_IN]->(c:Category)
            WITH c.name AS category, r.weight AS weight
            ORDER BY weight DESC
            LIMIT 2
            WITH collect({category: category, type: 'personalized', weight: weight}) AS personalizedItems

            // Bölüm 2: Fanus Kırıcı (Keşif)
            MATCH (allCat:Category)
            WHERE NOT EXISTS {
                MATCH (u:User {id: $userId})-[r2:INTERESTED_IN]->(allCat)
                WHERE r2.weight > 0.5
            }
            WITH allCat.name AS category, rand() AS randomSort, personalizedItems
            ORDER BY randomSort
            LIMIT 1
            WITH personalizedItems, collect({category: category, type: 'discovery', weight: 'N/A'}) AS discoveryItems

            // İkisini birleştir ve feed olarak döndür
            RETURN personalizedItems + discoveryItems AS feed
        `;

        const result = await session.run(query, { userId });
        const feed = result.records[0]?.get('feed') || [];

        res.json({
            userId,
            message: "Here is your echo-cancelled feed",
            feed
        });
    } catch (error) {
        console.error('[Feed] Error fetching feed:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        await session.close();
    }
});

app.listen(PORT, () => {
    console.log(`Feed Recommendation Service started on http://localhost:${PORT}`);
});