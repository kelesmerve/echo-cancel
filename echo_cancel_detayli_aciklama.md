# EchoCancel — Projenin Baştan Sona Detaylı Açıklaması

## 🎯 Projenin Amacı Nedir?

EchoCancel, sosyal medya platformlarındaki **"echo chamber" (yankı odası) problemini** çözmek için tasarlanmış bir backend sistemidir.

**Echo chamber nedir?** Sosyal medya algoritmalar genellikle kullanıcıya yalnızca sevdiği içerikleri gösterir. Zamanla kullanıcı kendi görüşlerini pekiştiren bir baloncuğa hapseder — başka perspektifler göremez. EchoCancel bunu **kasıtlı olarak kırar**: feed'in büyük kısmı kişiselleştirilmiş içerik olsa da, sistemin aktif olarak **"keşif" (discovery) içerikleri** de enjekte eder.

---

## 🗂 Klasör Yapısı — Genel Harita

```
echo-cancel/
│
├── api-gateway/              → Tek giriş noktası. JWT doğrulama burada.
├── user-profile-service/     → Kullanıcı bilgilerini tutar (PostgreSQL)
├── interaction-ingestion/    → Kullanıcı etkileşimlerini alır (Go servisi)
├── feed-recommendation/      → Kişiselleştirilmiş + keşif feed'i döner
├── graph-updater-service/    → İlgi grafiğini günceller (DIW algoritması burada)
│
├── infrastructure/
│   └── docker-compose.yml    → 4 bağımlılığı (DB, cache, queue) ayağa kaldırır
│
├── .env                      → Gerçek ortam değişkenleri (git'e gitmez)
├── .env.example              → Takım arkadaşları için şablon
└── .gitignore                → node_modules, .env, derlenmiş dosyalar hariç tutuluyor
```

---

## 🔄 Sistemin Veri Akışı — Büyük Resim

```
[Kullanıcı]
    │
    │  HTTP isteği + JWT token
    ▼
[api-gateway :3000]
    │  JWT doğrula → x-user-uuid header'a yaz
    │
    ├──── GET /api/feed ──────────────────────► [feed-recommendation :3003]
    │                                                   │
    │                                            Neo4j'den ağırlıklı
    │                                            kategorileri çek,
    │                                            feed oluştur, döndür
    │
    ├──── POST /api/interactions ────────────► [interaction-ingestion :3002]
    │                                                   │
    │                                            Redis idempotency kontrol
    │                                            RabbitMQ'ya event yaz
    │                                                   │
    │                                                   ▼
    │                                         [RabbitMQ kuyruğu]
    │                                                   │
    │                                                   ▼
    │                                         [graph-updater-service :3004]
    │                                                   │
    │                                            Neo4j'deki ilgi ağırlığını güncelle
    │                                            (DIW Algoritması burada çalışır)
    │
    └──── GET /api/users ────────────────────► [user-profile-service :3001]
                                                    │
                                              PostgreSQL'den kullanıcı
                                              bilgilerini döndür
```

---

## 📦 Her Servisin Detaylı Açıklaması

---

### 1. `api-gateway/` — Sistemin Kapıcısı

**Teknoloji:** Node.js + TypeScript + Express  
**Port:** 3000  
**Görev:** Dışarıdan gelen tüm istekleri karşılayan **tek giriş noktası**. Hiçbir servis dışarıya doğrudan açık değil — her şey buradan geçmek zorunda.

#### `src/index.ts` — Ana Dosya

```
/api/users        → verifyToken → proxy → user-profile-service:3001
/api/interactions → verifyToken → proxy → interaction-ingestion:3002
/api/feed         → verifyToken → proxy → feed-recommendation:3003
/health           → doğrudan cevap (JWT gerektirmez)
```

Gateway bir şey "hesaplamaz" — sadece yönlendirir (reverse proxy). Ama yönlendirmeden önce JWT'yi doğrular.

#### `src/middlewares/auth.ts` — JWT Doğrulama

Bu dosya **Zero-Trust güvenlik modelinin** temelidir.

**Nasıl çalışır?**
1. İstekten `Authorization: Bearer <token>` header'ını alır
2. Token yoksa → `401 Unauthorized`
3. `jwt.verify(token, JWT_SECRET)` ile imzayı doğrular
4. Token geçersizse → `403 Forbidden`
5. Token geçerliyse → içindeki `userId`'yi çıkarır ve isteğe `x-user-uuid` header olarak ekler
6. İsteği arkadaki servise iletir

**Neden bu önemli?** Arkadaki hiçbir servis JWT görmez ve doğrulamaz. Sadece `x-user-uuid` header'ına güvenir. Bu header'ı API Gateway'den başka kimse ekleyemez çünkü JWT secret sadece gateway'de. Buna **Zero-Trust** denir: her servis kendi sınırındaki veriyi güvende tutar, diğerine güven değil, doğrulanmış kimlik iletir.

---

### 2. `interaction-ingestion/` — Etkileşim Alma Servisi

**Teknoloji:** **Go** (diğer servisler Node.js, bu Go — bilinçli tercih)  
**Port:** 3002  
**Görev:** Kullanıcının bir içerikle etkileşimini (tıklama, beğeni, atlama) alıp asenkron işleme kuyruğuna atar.

**Neden Go?** Bu servis sistemin en yüksek trafiği alan noktası. Kullanıcı her scroll ettiğinde, her tıkladığında buraya istek gelir. Go'nun düşük bellek tüketimi ve goroutine modeli bu yük için idealdir.

#### `main.go` — Tüm Mantık Tek Dosyada

**Başlangıçta ne yapar:**
- Redis'e bağlanır (idempotency için)
- RabbitMQ'ya bağlanır (event kuyruğu için)
- `interaction_events` kuyruğunu declare eder (yoksa oluşturur)
- HTTP sunucusunu başlatır

**Bir istek geldiğinde:**

```
POST /
{
  "category": "politics",
  "action": "click"
}
Header: Authorization: Bearer <jwt>  (gateway bunu x-user-uuid'ye çevirdi)
Header: Idempotency-Key: <uuid>
```

**İşlem sırası:**

1. **Backpressure kontrolü** — Semaphore ile aynı anda max 100 istek işlenir. Sistem doluysa `503 Service Unavailable` döner. Sistemi flood'dan korur.

2. **x-user-uuid kontrolü** — Header yoksa `401`. (Gateway bypass edilmeye çalışılıyor demektir)

3. **Idempotency kontrolü** — Redis'te `idempotency:<key>` var mı?  
   - Varsa: İstek zaten işlendi, tekrar işlemeden `200` döner (duplicate koruması)  
   - Yoksa: Redis'e yazar (24 saat TTL), işleme devam eder

4. **JSON parse** — Body'den `category` ve `action` alınır. `userId` body'den değil `x-user-uuid` header'dan alınır (güvenlik: kullanıcı kendi userId'sini body'de gönderemez)

5. **RabbitMQ'ya publish** — Event JSON olarak `interaction_events` kuyruğuna yazılır

6. **Hata durumunda** — RabbitMQ'ya yazılamazsa Redis kaydı silinir. Böylece kullanıcı tekrar deneyebilir (idempotency key'i kirletmemiş olur)

---

### 3. `graph-updater-service/` — DIW Algoritmasının Evi

**Teknoloji:** Node.js + TypeScript  
**Port:** 3004  
**Görev:** RabbitMQ kuyruğunu **pasif olarak** dinler. Gelen her event için Neo4j'deki kullanıcı-kategori ilgi ağırlığını günceller. Bu servis dışarıdan HTTP isteği almaz (sadece `/health` var) — tamamen event-driven çalışır.

#### DIW (Dynamic Interest Weighting) Algoritması

Bu projenin **beyin** kısmı burada.

**Veri Modeli (Neo4j Graf):**
```
(User {id: "user-001"}) -[:INTERESTED_IN {weight: 0.7}]→ (Category {name: "technology"})
(User {id: "user-001"}) -[:INTERESTED_IN {weight: 0.3}]→ (Category {name: "politics"})
```

Her kullanıcı ile her kategori arasında bir **ağırlık (weight)** var. Bu ağırlık 0 ile 1 arasında bir değer. Yüksek ağırlık = yüksek ilgi.

**Ağırlık Güncelleme Kuralları:**

| Eylem | Değişim |
|---|---|
| `click` | +0.1 |
| `like` | +0.1 |
| `skip` | -0.1 |
| `dislike` | -0.1 |
| diğer | değişmez |

**Cypher Sorgusu (Neo4j):**
```cypher
MERGE (u:User {id: $userId})          -- Kullanıcı yoksa oluştur
MERGE (c:Category {name: $category})  -- Kategori yoksa oluştur
MERGE (u)-[r:INTERESTED_IN]->(c)      -- İlişki yoksa oluştur
ON CREATE SET r.weight = 0.5 + $weightDelta   -- İlk kez: 0.5'ten başla
ON MATCH SET r.weight = r.weight + $weightDelta  -- Sonraki: mevcut + delta
RETURN r.weight as newWeight
```

**Neden 0.5 başlangıç?** Yeni bir kategori gördüğünde kullanıcı ne kadar ilgili bilinmiyor. 0.5 "nötr" başlangıç noktası. İlk tıklama → 0.6, ikinci tıklama → 0.7... ilk skip → 0.4.

**RabbitMQ bağlantı yönetimi:**
Bağlantı kesilirse 5 saniye bekleyip tekrar dener. Basit ama çalışır.

---

### 4. `feed-recommendation/` — Feed Oluşturma Servisi

**Teknoloji:** Node.js + TypeScript + Neo4j  
**Port:** 3003  
**Görev:** Kullanıcıya gösterilecek feed'i oluşturur. **Echo-cancel** konseptinin kullanıcıya yansıdığı nokta tam burası.

#### Feed Algoritması (2 Bölümlü Cypher Sorgusu)

```cypher
-- BÖLÜM 1: Kişiselleştirilmiş İçerikler (Favoriler)
MATCH (u:User {id: $userId})-[r:INTERESTED_IN]->(c:Category)
WITH c.name AS category, r.weight AS weight
ORDER BY weight DESC
LIMIT 2
-- → En çok sevilen 2 kategori alınır

-- BÖLÜM 2: Fanus Kırıcı (Keşif / Discovery)
MATCH (allCat:Category)
WHERE NOT EXISTS {
  MATCH (u:User {id: $userId})-[r2:INTERESTED_IN]->(allCat)
  WHERE r2.weight > 0.5
}
-- → Kullanıcının 0.5'in üzerinde ilgi göstermediği kategoriler
ORDER BY rand()
LIMIT 1
-- → Bunlardan rastgele 1 tane seç

-- İKİSİNİ BİRLEŞTİR
RETURN personalizedItems + discoveryItems AS feed
```

**Sonuç şu şekilde görünür:**
```json
{
  "userId": "user-001",
  "message": "Here is your echo-cancelled feed",
  "feed": [
    { "category": "technology", "type": "personalized", "weight": 0.8 },
    { "category": "science",    "type": "personalized", "weight": 0.7 },
    { "category": "cooking",    "type": "discovery",    "weight": "N/A" }
  ]
}
```

İlk iki içerik kullanıcının ilgi alanından, son içerik **kullanıcının hiç ilgilenmediği** bir kategoriden. Bu "echo chamber'ı kıran" adım.

---

### 5. `user-profile-service/` — Kullanıcı Profil Servisi

**Teknoloji:** Node.js + TypeScript + PostgreSQL  
**Port:** 3001  
**Görev:** Kullanıcı profil bilgilerini (ad, email, tercihler vb.) saklamak ve döndürmek.

**Mevcut durum:** PostgreSQL bağlantısı kurulu ama şu an yalnızca `x-user-uuid` header'ını echo'layan bir `/` endpoint'i var. Bu servis mimari olarak doğru yerleştirilmiş ancak iş mantığı (CRUD endpoint'leri, kullanıcı kaydı vb.) henüz geliştirilmemiş — tasarımda bir **placeholder** olarak duruyor.

---

### 6. `infrastructure/docker-compose.yml` — Tüm Bağımlılıkları Ayağa Kaldırır

Servislerin çalışabilmesi için 4 harici bağımlılık gerekiyor:

| Servis | İmaj | Port | Kim Kullanıyor |
|---|---|---|---|
| **PostgreSQL** | postgres:15-alpine | 5433 | user-profile-service |
| **Redis** | redis:7-alpine | 6379 | interaction-ingestion (idempotency) |
| **RabbitMQ** | rabbitmq:3-management | 5672 / 15672 | interaction-ingestion → graph-updater |
| **Neo4j** | neo4j:5 | 7474 / 7687 | feed-recommendation + graph-updater |

Tek komutla hepsi başlar:
```bash
docker-compose up -d
```

RabbitMQ'nun 15672 portu bir **web yönetim paneli** sunar — tarayıcıdan kuyruk durumunu, mesaj sayısını izleyebilirsin.

---

## 🔐 Güvenlik Mimarisi Özeti

```
Dış Dünya
    │
    │ ← Yalnızca JWT taşıyan istekler geçer
    ▼
[API Gateway]  ← JWT_SECRET sadece burada
    │
    │ ← JWT token silinir, yerine x-user-uuid eklenir
    ▼
[İç Servisler] ← JWT bilmez, sadece x-user-uuid'ye güvenir
```

Bu mimaride:
- Kullanıcı kendi `userId`'sini **asla manipüle edemez**
- Servisler arası iletişimde JWT overhead'i yoktur
- Bir iç servis ele geçirilse bile dışarıya token sızdırmaz

---

## ⚙️ Teknoloji Seçimlerinin Mantığı

| Teknoloji | Nerede | Neden |
|---|---|---|
| **Go** | interaction-ingestion | Yüksek trafik — goroutine + düşük bellek |
| **TypeScript** | diğer tüm servisler | Tip güvenliği + hızlı geliştirme |
| **Neo4j** | graph-updater + feed | İlişkisel veri için graf DB idealdir; `INTERESTED_IN` kenar ağırlığı sorguları SQL'de çok karmaşık olurdu |
| **PostgreSQL** | user-profile | Yapılandırılmış kullanıcı verisi için ilişkisel DB uygun |
| **Redis** | interaction-ingestion | Microsaniye hızında anahtar-değer kontrolü — idempotency için mükemmel |
| **RabbitMQ** | ingestion → updater arası | Servisler arası asenkron iletişim; ingestion servisi grafı güncellemek zorunda kalmaz |

---

## 🧩 Algoritmanın Projedeki Rolü — Bütünleşik Bakış

```
Kullanıcı "politics" içeriğini ATLAR (skip)
          │
          ▼
interaction-ingestion → Redis (idempotency) → RabbitMQ
                                                    │
                                                    ▼
                                         graph-updater-service
                                                    │
                                         DIW: politics weight -= 0.1
                                         (0.6 → 0.5)
                                                    │
                                                    ▼
                                              Neo4j güncellenir

Kullanıcı sonraki feed'i istediğinde:
          │
          ▼
feed-recommendation Neo4j'den okur:
  - politics weight: 0.5 → artık "kişiselleştirilmiş" top-2'ye girmiyor
  - discovery slota başka bir kategori giriyor
```

DIW algoritması böylece **gerçek zamanlı** olarak feed'i şekillendirir. Her etkileşim bir sonraki feed'i etkiler. Sistem kullanıcının o anki ilgi durumuna dinamik olarak adapte olur.
