import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('CRITICAL: JWT_SECRET ortam degiskeni tanimlanmamis. Sunucu baslatilamiyor.');
}

export const verifyToken = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers['authorization'];
    
    if (!authHeader) {
        res.status(401).json({ error: 'Authorization header is missing' });
        return;
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
        res.status(401).json({ error: 'Token is missing' });
        return;
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
        
        // Zero-Trust: Gelen payload'daki ID'leri sil ve sadece JWT'den çıkan doğrulanmış ID'yi header'a ekle.
        req.headers['x-user-uuid'] = decoded.userId;
        
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid or expired token' });
        return;
    }
};