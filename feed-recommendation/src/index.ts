import express from 'express';
import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
// API Gateway 3003 portuna yönlendirme yapıyor
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

// Docker Compose dosyamızdaki Neo4j bağlantı bilgileri
const driver = neo4j.driver(
    process.env.NEO4J_URI || 'bolt://localhost:7687',
    neo4j.auth.basic(
        process.env.NEO4J_USER || 'neo4j', 
        process.env.NEO4J_PASSWORD || ''
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

// Temel endpoint
app.get('/', (req, res) => {
    // Zero-Trust: API Gateway'den gelen kimlik doğrulanmış UUID
    const userUuid = req.headers['x-user-uuid'];
    
    res.status(200).json({ 
        message: 'Feed Recommendation Service is running',
        authenticatedUser: userUuid || 'No authenticated user UUID received'
    });
});

app.listen(PORT, () => {
    console.log(`Feed Recommendation Service started on http://localhost:${PORT}`);
});