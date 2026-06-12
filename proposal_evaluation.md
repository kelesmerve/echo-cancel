# 📋 EchoCancel — Proposal'a Göre Tamamlanma Değerlendirmesi
> CENG-442 | Şevval Çakmak & Merve Keleş | Değerlendirme: 09 Haziran 2026

---

## 🗂️ Değerlendirme Metodolojisi

Her proposal gereksinimi kodda doğrudan kontrol edildi.  
Puanlama: ✅ Tam (1.0) | 🟡 Kısmi (0.5) | ❌ Yok (0.0)

---

## § 5.1 — API Gateway
**Sorumluluk:** Ortak | **Teknoloji:** Node.js / TypeScript

| # | Proposal Gereksinimi | Kod Durumu | Puan |
|---|---|---|---|
| 1 | JWT token doğrulama | ✅ `auth.ts` → `jwt.verify()` | 1.0 |
| 2 | User UUID extraction from JWT | ✅ `decoded.userId` → `x-user-uuid` header | 1.0 |
| 3 | Route → User Profile Service | ✅ `/api/users` → `localhost:3001` | 1.0 |
| 4 | Route → Interaction Ingestion | ✅ `/api/interactions` → `localhost:3002` | 1.0 |
| 5 | Route → Feed Recommendation | ✅ `/api/feed` → `localhost:3003` | 1.0 |
| 6 | Zero-Trust: payload userId güvenilmez | ✅ JWT'den gelen UUID downstream'e iletiliyor | 1.0 |
| 7 | `/metrics` Prometheus endpoint | ❌ `prom-client` yok | 0.0 |
| **TOPLAM** | | | **6/7 = %86** |

---

## § 5.2 — User Profile Service
**Sorumluluk:** Ortak | **Teknoloji:** Node.js / TypeScript + PostgreSQL

| # | Proposal Gereksinimi | Kod Durumu | Puan |
|---|---|---|---|
| 1 | UUID, display_name, email sakla | ✅ PostgreSQL `users` tablosu | 1.0 |
| 2 | PostgreSQL bağlantısı | ✅ `pg.Pool` + `initDB()` ile auto-create | 1.0 |
| 3 | **Create** endpoint (POST) | ✅ `POST /` — DB insert + Saga event | 1.0 |
| 4 | **Read** endpoint (GET) | ✅ `GET /` — `SELECT WHERE id=$1` | 1.0 |
| 5 | **Update** endpoint (PUT) | ❌ Yok | 0.0 |
| 6 | **Delete** endpoint (DELETE) | ❌ Yok | 0.0 |
| 7 | `/health` endpoint | ❌ Yok | 0.0 |
| 8 | `/metrics` Prometheus endpoint | ❌ Yok | 0.0 |
| **TOPLAM** | | | **4/8 = %50** |

---

## § 5.3 — Interaction Ingestion Service
**Sorumluluk:** Şevval Çakmak | **Teknoloji:** Go + RabbitMQ + Redis

| # | Proposal Gereksinimi | Kod Durumu | Puan |
|---|---|---|---|
| 1 | Click event kabul | ✅ `action` field ile geçiyor | 1.0 |
| 2 | Impression event kabul | ✅ `action: "impression"` geçiyor | 1.0 |
| 3 | Skip event kabul | ✅ `action: "skip"` geçiyor | 1.0 |
| 4 | Idempotency-Key Redis kontrolü (SetNX) | ✅ 24 saatlik TTL ile `SetNX` | 1.0 |
| 5 | Duplicate → yeniden kuyruğa almadan 200 | ✅ `!exists` → 200 döner, queue'ya yazmaz | 1.0 |
| 6 | RabbitMQ'ya publish | ✅ `interaction_events` queue, durable | 1.0 |
| 7 | Backpressure → HTTP 503 | ✅ Semaphore (100 slot) → 503 | 1.0 |
| 8 | **Transactional Outbox Pattern** | ❌ Doğrudan RabbitMQ yazıyor, DB outbox yok | 0.0 |
| 9 | `/metrics` Prometheus endpoint | ❌ Yok | 0.0 |
| 10 | `action` field validasyonu | ❌ Geçersiz action string queue'ya gidiyor | 0.0 |
| 11 | `go.mod` geçerli Go sürümü | 🔴 `go 1.26.3` — var olmayan sürüm | 0.0 |
| **TOPLAM** | | | **7/11 = %64** |

---

## § 5.4 — Graph Updater & Weighting Service
**Sorumluluk:** Merve Keleş | **Teknoloji:** Node.js / TypeScript + Neo4j + Redis

| # | Proposal Gereksinimi | Kod Durumu | Puan |
|---|---|---|---|
| 1 | RabbitMQ subscribe (`interaction_events`) | ✅ `channel.consume()` | 1.0 |
| 2 | Neo4j MERGE upsert `(User)-[INTERESTED_IN]->(Category)` | ✅ Cypher MERGE sorgusu | 1.0 |
| 3 | Click → edge weight artışı | ✅ `+0.1` delta | 1.0 |
| 4 | Impression event → Redis TTL cache | ✅ `setEx(key, 60, 'true')` | 1.0 |
| 5 | Impression+Skip çifti → Fatigue Penalty | ✅ `-0.2` ağır ceza (vs `-0.05` sıradan) | 1.0 |
| 6 | Yeni edge → initial weight ile oluştur | ✅ `ON CREATE SET r.weight = 0.5 + delta` | 1.0 |
| 7 | **Saga Consumer** (`user.created` event) | ✅ Neo4j'de User node MERGE ediyor | 1.0 |
| 8 | Weight clamping (0.0–1.0 sınırı) | ❌ Yok — sınırsız büyüyebilir/küçülebilir | 0.0 |
| 9 | PORT hesaplama doğruluğu | 🔴 `process.env.PORT + 4` — string concat riski | 0.5 |
| 10 | `/metrics` Prometheus endpoint | ❌ Yok | 0.0 |
| 11 | Saga compensating transaction (hata durumu) | ❌ Sadece `console.error`, geri alma yok | 0.0 |
| **TOPLAM** | | | **8.5/11 = %77** |

---

## § 5.5 — Feed Recommendation Service
**Sorumluluk:** Merve Keleş | **Teknoloji:** Node.js / TypeScript + Neo4j

| # | Proposal Gereksinimi | Kod Durumu | Puan |
|---|---|---|---|
| 1 | Neo4j'den edge'leri weight'e göre sırala | ✅ `ORDER BY weight DESC LIMIT 2` | 1.0 |
| 2 | Kişiselleştirilmiş feed (top categories) | ✅ En yüksek 2 kategori | 1.0 |
| 3 | Echo-Cancel discovery item | ✅ `weight ≤ 0.5` kategorilerden random 1 | 1.0 |
| 4 | JSON payload döndür | ✅ `{userId, message, feed[]}` | 1.0 |
| 5 | Gerçek content item'ları getir | 🟡 Kategori adı dönüyor, içerik detayı yok | 0.5 |
| 6 | Fallback userId güvenlik riski | ❌ `|| 'test-user-uuid-1234'` var | 0.0 |
| 7 | PORT env'den oku | ❌ `const PORT = 3003` hardcoded | 0.0 |
| 8 | `/metrics` Prometheus endpoint | ❌ Yok | 0.0 |
| **TOPLAM** | | | **4.5/8 = %56** |

---

## § 6 & § 7 — Cross-Cutting Concerns

### 6.2 — RabbitMQ Pub/Sub İletişimi
| Gereksinim | Durum | Puan |
|---|---|---|
| Interaction Ingestion → RabbitMQ publish | ✅ | 1.0 |
| Graph Updater → RabbitMQ subscribe | ✅ | 1.0 |
| Durable queue | ✅ | 1.0 |
| Saga exchange (`saga_events`, topic) | ✅ | 1.0 |
| **TOPLAM** | | **4/4 = %100** |

### 6.3 — Prometheus & Grafana (§7 Technology Stack)
| Gereksinim | Durum | Puan |
|---|---|---|
| Her serviste `/metrics` endpoint | ❌ 0/5 serviste var | 0.0 |
| `docker-compose`'da Prometheus servisi | ❌ Yok | 0.0 |
| `docker-compose`'da Grafana servisi | ❌ Yok | 0.0 |
| `prometheus.yml` scrape config | ❌ Yok | 0.0 |
| **TOPLAM** | | **0/4 = %0** |

### Infrastructure — Docker Compose
| Gereksinim | Durum | Puan |
|---|---|---|
| PostgreSQL container | ✅ | 1.0 |
| Redis container | ✅ | 1.0 |
| RabbitMQ container | ✅ | 1.0 |
| Neo4j container | ✅ | 1.0 |
| Prometheus container | ❌ | 0.0 |
| Grafana container | ❌ | 0.0 |
| Uygulama servisleri compose'da | ❌ 0/5 servis | 0.0 |
| `depends_on` + `healthcheck` | ❌ Yok | 0.0 |
| **TOPLAM** | | **4/8 = %50** |

### Kubernetes (§1 — Merve'nin sorumluluğu)
| Gereksinim | Durum | Puan |
|---|---|---|
| `Deployment.yaml` dosyaları | ❌ | 0.0 |
| `Service.yaml` dosyaları | ❌ | 0.0 |
| `ConfigMap.yaml` | ❌ | 0.0 |
| `Secret.yaml` | ❌ | 0.0 |
| `Ingress.yaml` | ❌ | 0.0 |
| **TOPLAM** | | **0/5 = %0** |

---

## 👤 Kişi Bazında Sorumluluk Skoru

### Şevval Çakmak — Distributed Systems Engineer
| Sorumluluk | Oran |
|---|---|
| Interaction Ingestion Service | %64 |
| Message Broker Integration (RabbitMQ) | %100 |
| Transactional Outbox Pattern | **%0** |
| Idempotency Management | %100 |
| **Ortalama** | **%66** |

### Merve Keleş — Graph & DevOps Engineer
| Sorumluluk | Oran |
|---|---|
| Graph Updater & Weighting Service | %77 |
| Neo4j Graph Modeling | %90 |
| Saga Pattern (tam compensating transaction hariç) | %67 |
| Recommendation Engine | %56 |
| Kubernetes Deployment | **%0** |
| **Ortalama** | **%58** |

---

## 📊 Genel Proje Skoru (Proposal'a Göre)

| Bileşen | Ağırlık | Skor | Katkı |
|---|---|---|---|
| § 5.1 API Gateway | %12 | %86 | 10.3 |
| § 5.2 User Profile Service | %12 | %50 | 6.0 |
| § 5.3 Interaction Ingestion | %15 | %64 | 9.6 |
| § 5.4 Graph Updater | %18 | %77 | 13.9 |
| § 5.5 Feed Recommendation | %13 | %56 | 7.3 |
| RabbitMQ İletişimi | %8 | %100 | 8.0 |
| Prometheus + Grafana | %10 | **%0** | 0.0 |
| Docker Compose + K8s | %12 | %25 | 3.0 |
| **GENEL** | **%100** | | **58.1** |

---

## 🎯 Sonuç

```
§5.1 API Gateway           [█████████████████░░░]  %86  ✅
§5.4 Graph Updater (DIW)   [███████████████░░░░░]  %77  ✅
§5.3 Interaction Ingestion [████████████░░░░░░░░]  %64  ⚠️
§5.5 Feed Recommendation   [███████████░░░░░░░░░]  %56  ⚠️
§5.2 User Profile Service  [██████████░░░░░░░░░░]  %50  ⚠️
Docker Compose / Infra     [█████░░░░░░░░░░░░░░░]  %25  ❌
Prometheus + Grafana       [░░░░░░░░░░░░░░░░░░░░]   %0  ❌
Kubernetes                 [░░░░░░░░░░░░░░░░░░░░]   %0  ❌

GENEL PROJE SKORU          [████████████░░░░░░░░]  %58
```

### 🔴 Submission'ı En Çok Etkileyen 3 Eksik

| Öncelik | Eksiklik | Etki |
|---|---|---|
| 1 | **Prometheus + Grafana** | §7 Technology Stack'te açıkça listelenmiş, %0 |
| 2 | **Kubernetes Manifests** | Merve'nin birincil sorumluluğu, %0 |
| 3 | **Transactional Outbox** | Şevval'in birincil sorumluluğu, %0 |
