import amqp from 'amqplib';
import { pool } from './config/database';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672/';

export async function startConsumer() {
    try {
        const connection = await amqp.connect(RABBITMQ_URL);
        const channel = await connection.createChannel();

        await channel.assertExchange('saga_events', 'topic', { durable: true });
        const q = await channel.assertQueue('user_compensation_queue', { durable: true });
        await channel.bindQueue(q.queue, 'saga_events', 'user.creation_failed');

        console.log('[Consumer] RabbitMQ connected for Saga Compensations (user.creation_failed)');

        channel.consume(q.queue, async (msg) => {
            if (msg !== null) {
                try {
                    const eventData = JSON.parse(msg.content.toString());
                    const { userId } = eventData;
                    if (userId) {
                        console.log(`[Saga Rollback] Kullanici olusturma telafisi baslatildi. Siliniyor ID: ${userId}`);
                        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
                        console.log(`[Saga Rollback] Kullanici veritabanindan silindi (Rollback basarili): ${userId}`);
                    }
                } catch (err) {
                    console.error('[Saga Rollback] Hata olustu:', err);
                }
                channel.ack(msg);
            }
        });
    } catch (err) {
        console.error('[Consumer] RabbitMQ compensating consumer connection failed, retrying in 5 seconds...', err);
        setTimeout(startConsumer, 5000);
    }
}
