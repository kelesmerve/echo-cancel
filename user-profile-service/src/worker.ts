import dotenv from 'dotenv';
dotenv.config();

import amqp from 'amqplib';
import { pool } from './config/database';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';

// KRİTİK 1: 'export' kelimesi eklendi
export async function startWorker() {
    let channel: amqp.Channel;

    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        await channel.assertExchange('saga_events', 'topic', { durable: true });
        console.log('[Worker] RabbitMQ connected for Outbox Polling');
    } catch (err) {
        console.error('[Worker] RabbitMQ connection failed, retrying in 5 seconds...', err);
        setTimeout(startWorker, 5000);
        return;
    }

    console.log('[Worker] Outbox Polling started. Looking for PENDING events...');

    setInterval(async () => {
        try {
            const res = await pool.query(
                `SELECT * FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC`
            );
            const events = res.rows;

            for (const event of events) {
                const routingKey = event.event_type === 'UserCreated' ? 'user.created' : 'user.deleted';

                channel.publish(
                    'saga_events',
                    routingKey,
                    Buffer.from(JSON.stringify(event.payload))
                );

                await pool.query(
                    `UPDATE outbox_events SET status = 'PROCESSED' WHERE id = $1`,
                    [event.id]
                );

                console.log(`[Worker] Event islendi ve RabbitMQ'ya gonderildi. ID: ${event.id} | Type: ${event.event_type}`);
            }
        } catch (error) {
            console.error('[Worker] Outbox event okuma/yazma hatasi:', error);
        }
    }, 2000);
}

// KRİTİK 2: En alttaki startWorker(); çağrısını SİLDİK!