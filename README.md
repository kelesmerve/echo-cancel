# EchoCancel 🚫📢

**Dynamic Interest-Weighted Echo Chamber Breaker**

Sosyal medya kullanıcılarını bilgi baloncuklarından (echo chamber) kurtarmak için tasarlanmış, event-driven microservice mimarisi.

---

## 📋 Gereksinimler

Başlamadan önce aşağıdakilerin kurulu olduğundan emin ol:

| Araç | Sürüm | Kontrol |
|---|---|---|
| [Node.js](https://nodejs.org) | v18+ | `node --version` |
| [Go](https://go.dev/dl/) | v1.21+ | `go version` |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Güncel | `docker --version` |

---

## 🚀 Kurulum & Çalıştırma (Sıfırdan)

### Adım 1 — Repoyu klonla

```bash
git clone https://github.com/kelesmerve/echo-cancel.git
cd echo-cancel
```

---

### Adım 2 — `.env` dosyasını oluştur

Kök dizindeki `.env.example` dosyasını kopyala ve `.env` olarak kaydet:

```bash
# Windows (PowerShell)
Copy-Item .env.example .env

# Mac / Linux
cp .env.example .env
```

Sonra `.env` dosyasını aç ve şu değerleri doldur:

```env
# API Gateway
JWT_SECRET=buraya-en-az-32-karakter-rastgele-bir-seyler-yaz
PORT=3000

# User Profile Service
DB_USER=admin
DB_HOST=localhost
DB_NAME=userprofile_db
DB_PASSWORD=password123
DB_PORT=5433

# Feed Recommendation & Graph Updater
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password123

# Interaction Ingestion (Go)
REDIS_ADDR=localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
```

> ⚠️ `JWT_SECRET` için gerçekten rastgele bir değer yaz. Kısa veya basit olursa token güvenliği yoktur.

---

### Adım 3 — Altyapıyı başlat (Docker)

Docker Desktop'ın açık olduğundan emin ol, sonra:

```bash
cd infrastructure
docker compose up -d
```

Bu komut şunları başlatır:
- **PostgreSQL** → `localhost:5433`
- **Redis** → `localhost:6379`
- **RabbitMQ** → `localhost:5672` (Yönetim paneli: `localhost:15672`)
- **Neo4j** → `localhost:7687` (Tarayıcı arayüzü: `localhost:7474`)

Hepsinin ayakta olup olmadığını kontrol et:

```bash
docker compose ps
```

`State` kolonunda hepsi `running` yazmalı. **Bunu geçmeden bir sonraki adıma geçme.**

---

### Adım 4 — Her servis için bağımlılıkları yükle

Her servis klasörüne girip `npm install` çalıştır:

```bash
# API Gateway
cd ../api-gateway
npm install

# User Profile Service
cd ../user-profile-service
npm install

# Feed Recommendation
cd ../feed-recommendation
npm install

# Graph Updater Service
cd ../graph-updater-service
npm install

# Interaction Ingestion (Go) — node_modules DEĞİL, go mod kullanır
cd ../interaction-ingestion
go mod download
```

---

### Adım 5 — `.env` dosyasını servislere kopyala

Her servis kendi `.env` dosyasını kendi dizininde arar. Kök `.env`'yi kopyala:

```bash
# Windows (PowerShell) — echo-cancel/ kök dizininde çalıştır
cd ..   # echo-cancel/ kök dizinine dön
Copy-Item .env api-gateway\.env
Copy-Item .env user-profile-service\.env
Copy-Item .env feed-recommendation\.env
Copy-Item .env graph-updater-service\.env
Copy-Item .env interaction-ingestion\.env
```

---

### Adım 6 — Servisleri başlat

Her servis için **ayrı bir terminal penceresi** aç:

**Terminal 1 — API Gateway:**
```bash
cd echo-cancel/api-gateway
npm run start:dev
```
✅ Beklenen çıktı: `API Gateway started on http://localhost:3000`

---

**Terminal 2 — User Profile Service:**
```bash
cd echo-cancel/user-profile-service
npm run start:dev
```
✅ Beklenen çıktı:
```
User Profile Service started on http://localhost:3001
PostgreSQL database connected successfully
PostgreSQL "users" table is ready
```

---

**Terminal 3 — Interaction Ingestion (Go):**
```bash
cd echo-cancel/interaction-ingestion
go run main.go
```
✅ Beklenen çıktı:
```
Redis connected successfully
RabbitMQ connected successfully
Interaction Ingestion Service started on http://localhost:3002
```

---

**Terminal 4 — Feed Recommendation:**
```bash
cd echo-cancel/feed-recommendation
npm run start:dev
```
✅ Beklenen çıktı:
```
Feed Recommendation Service started on http://localhost:3003
Neo4j database connected successfully
```

---

**Terminal 5 — Graph Updater Service:**
```bash
cd echo-cancel/graph-updater-service
npm run start:dev
```
✅ Beklenen çıktı:
```
Graph Updater Service started on http://localhost:3004
Neo4j connected successfully.
Redis connected successfully for caching.
RabbitMQ listening on queue: interaction_events
RabbitMQ listening for Saga events on queue: saga_user_creation_queue
```

---

## ✅ Sistem Çalışıyor mu? Test Et

### 1. Gateway sağlık kontrolü
```bash
curl http://localhost:3000/health
```
```json
{ "status": "API Gateway is running" }
```

### 2. JWT token üret (test için)

`api-gateway/` klasöründe şunu çalıştır:
```bash
node -e "
const jwt = require('jsonwebtoken');
require('dotenv').config();
const token = jwt.sign({ userId: 'test-user-001' }, process.env.JWT_SECRET, { expiresIn: '24h' });
console.log('Bearer ' + token);
"
```
Bu token'ı kopyala — tüm isteklerde kullanacaksın.

### 3. Kullanıcı oluştur (Saga Pattern başlatır)
```bash
curl -X POST http://localhost:3000/api/users \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Test Kullanici", "email": "test@example.com"}'
```
```json
{ "message": "User created and Saga initiated", "user": {...} }
```

### 4. Etkileşim gönder (DIW algoritmasını tetikler)
```bash
curl -X POST http://localhost:3000/api/interactions \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"category": "technology", "action": "click"}'
```
```json
Interaction recorded and sent to queue
```

### 5. Feed al (Echo-Cancel çıktısı)
```bash
curl http://localhost:3000/api/feed \
  -H "Authorization: Bearer <TOKEN>"
```
```json
{
  "userId": "test-user-001",
  "message": "Here is your echo-cancelled feed",
  "feed": [
    { "category": "technology", "type": "personalized", "weight": 0.6 },
    { "category": "cooking",    "type": "discovery",    "weight": "N/A" }
  ]
}
```

---

## 🌐 Yönetim Arayüzleri

| Servis | URL | Kullanıcı / Şifre |
|---|---|---|
| RabbitMQ Yönetim | http://localhost:15672 | `guest` / `guest` |
| Neo4j Tarayıcı | http://localhost:7474 | `neo4j` / `password123` |

---

## 🗂 Port Referansı

| Servis | Port |
|---|---|
| API Gateway | 3000 |
| User Profile Service | 3001 |
| Interaction Ingestion | 3002 |
| Feed Recommendation | 3003 |
| Graph Updater | 3004 |
| PostgreSQL | 5433 |
| Redis | 6379 |
| RabbitMQ | 5672 |
| Neo4j Bolt | 7687 |

---

## 🛑 Durdurma

Altyapıyı durdurmak için:
```bash
cd infrastructure
docker compose down
```

Verileri de silmek istersen:
```bash
docker compose down -v
```
