/**
 * Test JWT Token Üretici
 * 
 * Kullanım: node generate-test-token.js
 * 
 * Bu script, .env'deki JWT_SECRET ile imzalanmış
 * geçici bir test token'ı üretir.
 * 
 * NOT: Bu dosya sadece local test amaçlıdır.
 * Production'a push etme ihtiyacı yok.
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');

const secret = process.env.JWT_SECRET;

if (!secret) {
    console.error('HATA: JWT_SECRET .env dosyasında bulunamadı.');
    process.exit(1);
}

const payload = {
    userId: 'test-user-001',  // Test için kullanıcı ID'si
};

const token = jwt.sign(payload, secret, { expiresIn: '1h' });

console.log('\n✅ Test JWT Token Üretildi:\n');
console.log('Bearer ' + token);
console.log('\n--- Postman / curl kullanımı ---');
console.log('Header: Authorization: Bearer ' + token);
console.log('\n--- curl örneği ---');
console.log(`curl -H "Authorization: Bearer ${token}" http://localhost:3000/api/feed`);
console.log('\n⏱  Token 1 saat geçerlidir.\n');
