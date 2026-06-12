const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const secret = process.env.JWT_SECRET || 'your-very-long-random-secret-here';
const userId = process.argv[2] || 'test-user-123';
const payload = { userId: userId };
const token = jwt.sign(payload, secret);
console.log(token);
