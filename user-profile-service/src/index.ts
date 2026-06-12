import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { initDB } from './config/database'; // Tabloyu kuran dogru dosya
import { createUser, getUser, updateUser, deleteUser } from './controllers/userController';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Veritabanı tablolarını (users ve outbox_events) olustur
initDB();

// --- CLEAN ARCHITECTURE ROUTING ---
app.post('/', createUser);
app.get('/', getUser);
app.put('/', updateUser);
app.delete('/', deleteUser);

app.listen(PORT, () => {
    console.log(`User Profile Service API started on http://localhost:${PORT}`);
});