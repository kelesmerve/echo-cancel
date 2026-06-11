import { pool } from '../config/database';

export class UserRepository {
    // Transactional Create: Kullanıcıyı ve Outbox kaydını aynı anda oluşturur
    async createUserWithOutbox(userId: string, displayName: string, email: string, eventPayload: any) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN'); // Transaction başlar

            const userRes = await client.query(
                `INSERT INTO users (id, display_name, email) VALUES ($1, $2, $3) RETURNING *`,
                [userId, displayName, email]
            );

            await client.query(
                `INSERT INTO outbox_events (event_type, payload, status) VALUES ($1, $2, 'PENDING')`,
                ['UserCreated', eventPayload]
            );

            await client.query('COMMIT'); // İkisi de başarılıysa onayla
            return userRes.rows[0];
        } catch (error) {
            await client.query('ROLLBACK'); // Hata varsa ikisini de iptal et
            throw error;
        } finally {
            client.release();
        }
    }

    // Transactional Delete: Kullanıcıyı siler ve "Silindi" eventini Outbox'a atar
    async deleteUserWithOutbox(userId: string, eventPayload: any) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const res = await client.query(`DELETE FROM users WHERE id = $1 RETURNING *`, [userId]);
            
            if (res.rowCount && res.rowCount > 0) {
                await client.query(
                    `INSERT INTO outbox_events (event_type, payload, status) VALUES ($1, $2, 'PENDING')`,
                    ['UserDeleted', eventPayload]
                );
            }

            await client.query('COMMIT');
            return res.rowCount && res.rowCount > 0;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async getUserById(userId: string) {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        return result.rows[0] || null;
    }

    async updateUser(userId: string, displayName: string) {
        const result = await pool.query(
            `UPDATE users SET display_name = $2 WHERE id = $1 RETURNING *`,
            [userId, displayName]
        );
        return result.rows[0] || null;
    }
}