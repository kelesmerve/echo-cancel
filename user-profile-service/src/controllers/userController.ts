import { Request, Response } from 'express';
import { UserService } from '../services/userService';

const userService = new UserService();

export const createUser = async (req: Request, res: Response) => {
    const { display_name, email } = req.body;
    const userId = req.headers['x-user-uuid'] as string;

    if (!userId) return res.status(401).json({ error: 'Unauthorized: No User UUID' });

    try {
        const user = await userService.createUser(userId, display_name, email);
        res.status(201).json({ message: "User created securely", user });
    } catch (err: any) {
if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
        
        // EKLENEN SATIR: Hatayı terminale yazdır
        console.error('[Kritik Hata] createUser hatasi:', err); 
        
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

export const getUser = async (req: Request, res: Response) => {
    const userId = req.headers['x-user-uuid'] as string;
    try {
        const user = await userService.getUser(userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

export const updateUser = async (req: Request, res: Response) => {
    const userId = req.headers['x-user-uuid'] as string;
    const { display_name } = req.body;
    try {
        const updatedUser = await userService.updateUser(userId, display_name);
        if (!updatedUser) return res.status(404).json({ error: 'User not found' });
        res.json({ message: "User updated", user: updatedUser });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

export const deleteUser = async (req: Request, res: Response) => {
    const userId = req.headers['x-user-uuid'] as string;
    try {
        const success = await userService.deleteUser(userId);
        if (!success) return res.status(404).json({ error: 'User not found' });
        res.json({ message: "User deleted and Saga compensation initiated" });
    } catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
};