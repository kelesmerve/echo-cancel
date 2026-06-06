import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import amqp from 'amqplib';
import neo4j from 'neo4j-driver';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) + 4 : 3004;

// RabbitMQ ve Neo4j Bağlantı Değişkenleri
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';
const QUEUE_NAME = 'interaction_events';

const NEO4J_URI = process.env.NEO4J_URI || 'bolt://localhost:7687';
const NEO4J_USER = process.env.NEO4J_USER || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD || 'password123';

// Neo4j Sürücüsünü Başlat
const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// DIW Algoritması: Neo4j Ağırlık Güncelleme Fonksiyonu
async function updateInterestWeight(userId: string, category: string, action: string) {
    const session = driver.session();
    try {
        // Matematiksel Mantık: Tıklama ilgi artırır, geçme (skip) ilgiyi azaltır.
        let weightDelta = 0;
        if (action === 'click' || action === 'like') {
            weightDelta = 0.1;
        } else if (action === 'skip' || action === 'dislike') {
            weightDelta = -0.1;
        }

        if (weightDelta === 0) return;

        // Cypher Sorgusu
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

async function connectRabbitMQ() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log(`RabbitMQ connected. Listening for messages on queue: ${QUEUE_NAME}`);

        channel.consume(QUEUE_NAME, async (msg) => {
            if (msg !== null) {
                const messageContent = msg.content.toString();
                console.log(`[x] Kuyruktan alınan mesaj: ${messageContent}`);
                
                try {
                    // Mesajı JSON olarak parse et
                    const eventData = JSON.parse(messageContent);
                    
                    // Gerekli verilerin varlığını kontrol et ve Neo4j'ye gönder
                    if (eventData.userId && eventData.category && eventData.action) {
                        await updateInterestWeight(eventData.userId, eventData.category, eventData.action);
                    } else {
                        console.log('[!] Eksik veri formatı, işlem atlandı.');
                    }
                } catch (parseError) {
                    console.error('[!] Mesaj parse edilemedi:', parseError);
                }

                // İşlem bitince mesajı kuyruktan güvenle sil
                channel.ack(msg);
            }
        });
    } catch (error) {
        console.error('RabbitMQ connection failed:', error);
        setTimeout(connectRabbitMQ, 5000);
    }
}

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'Graph Updater Service is running with Neo4j integration' });
});

app.listen(PORT, async () => {
    console.log(`Graph Updater Service started on http://localhost:${PORT}`);
    
    // Neo4j bağlantısını test et
    try {
        await driver.verifyConnectivity();
        console.log('Neo4j connected successfully.');
    } catch (err) {
        console.error('Neo4j connection error:', err);
    }

    connectRabbitMQ();
});