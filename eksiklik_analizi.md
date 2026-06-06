# EchoCancel — Proposal vs. Mevcut Kod: Eksiklik Analizi

## Özet Tablo

| # | Eksiklik | Proposal'da Neresi | Mevcut Durumu | Öncelik |
|---|---|---|---|---|
| 1 | **Impression event tipi** | §5.3, §2 | Yok — sadece click/like/skip/dislike var | 🔴 Critical |
| 2 | **Fatigue Penalty Score** | §2, §5.4 | Yok — impression+skip çifti hiç işlenmiyor | 🔴 Critical |
| 3 | **Prometheus + Grafana izleme** | §7, §6.3, §8 | Docker-compose'da yok, `/metrics` endpoint'i yok | 🔴 Critical |
| 4 | **User Profile Service CRUD** | §5.2 | Sadece stub `/` endpoint var, DB sorgusu yok | 🟡 Önemli |
| 5 | **Transactional Outbox Pattern** | §1 (Şevval'in sorumlulukları) | Yok | 🟡 Önemli |
| 6 | **Saga Pattern** | §1 (Merve'nin sorumlulukları) | Yok | 🟡 Önemli |
| 7 | **Kubernetes deployment** | §1 (Merve'nin sorumlulukları) | Yok | 🟡 Önemli |
| 8 | **Weight delta tutarsızlığı** | §5.4 "+10 delta" yazıyor | Kod 0.1 kullanıyor | 🟠 Küçük |
| 9 | **feed-recommendation PORT hardcoded** | — | `const PORT = 3003` — env-based değil | 🟠 Küçük |
| 10 | **feed-recommendation fallback userId** | — | Kimlik doğrulama bypass'ı riski | 🟠 Küçük |

---

## 🔴 Critical Eksiklikler (Notunuzu doğrudan etkiler)

---

### 1. Impression Event Tipi — HİÇ YOK

**Proposal ne diyor (§5.3):**
> "Accepts three event types: **Click, Impression, and Skip.**"

**Mevcut kod (`interaction-ingestion/main.go`):**
```go
type Interaction struct {
    UserID   string `json:"userId"`
    Category string `json:"category"`
    Action   string `json:"action"`   // click, like, skip, dislike — Impression YOK
}
```

Impression event tipi ne kodda ne de graph-updater'da handle ediliyor.

---

### 2. Fatigue Penalty Score — HİÇ YOK

**Proposal ne diyor (§2):**
> "When a piece of content appears on screen but is rapidly scrolled past without any interaction, the system records an **Impression event followed by a Skip event**. These two signals feed a **Fatigue Penalty Score** calculation that gradually suppresses stale, repetitive content clusters."

**Mevcut kod (`graph-updater-service/src/index.ts`):**
```typescript
if (action === 'click' || action === 'like') {
    weightDelta = 0.1;
} else if (action === 'skip' || action === 'dislike') {
    weightDelta = -0.1;
}
// Impression+Skip çifti kontrolü = YOK
// Fatigue Penalty Score = YOK
```

Şu an `skip` geldiğinde sadece `-0.1` yapılıyor. Ama proposal'a göre **Impression + Skip çifti birlikte gelmeli**, ve bu çift normal skip'ten farklı bir ceza uygulamalı. Bunun için:
1. Graph-updater'ın son N saniyede aynı kullanıcı+kategori için Impression görüp görmediğini takip etmesi gerekiyor (Redis TTL ile yapılabilir)
2. Fatigue Penalty delta değerinin normal skip'ten farklı (daha büyük) olması gerekiyor

---

### 3. Prometheus + Grafana — HİÇ YOK

**Proposal ne diyor (§6.3, §7, §8):**
> "All services → Prometheus: Metrics endpoint (/metrics) scraped at regular intervals; visualised in Grafana."
> "System-wide observability is provided by a Prometheus and Grafana monitoring stack."

**Mevcut durum:**
- `docker-compose.yml`'de `prometheus` ve `grafana` servisleri yok
- Hiçbir serviste `/metrics` endpoint'i yok
- `prom-client` (Node.js Prometheus kütüphanesi) hiçbir `package.json`'da yok

Bu proposal'ın §7 Technology Stack tablosunda ayrıca bir satır olarak listelenmiş:
> `Prometheus + Grafana | Industry-standard time-series scraping and dashboard visualisation`

---

## 🟡 Önemli Eksiklikler

---

### 4. User Profile Service — Sadece Stub

**Proposal ne diyor (§5.2):**
> "Stores and retrieves user profiles including UUID, display name, and account metadata."  
> "Exposes **CRUD endpoints** consumed by the API Gateway."

**Mevcut kod:**
```typescript
app.get('/', (req, res) => {
    const userUuid = req.headers['x-user-uuid'];
    res.status(200).json({ 
        message: 'User Profile Service is running',
        authenticatedUser: userUuid  // sadece echo ediyor
    });
});
// CREATE kullanıcı = YOK
// READ kullanıcı bilgisi = YOK  
// UPDATE kullanıcı = YOK
// DELETE kullanıcı = YOK
// PostgreSQL sorgusu = YOK
```

---

### 5. Transactional Outbox Pattern — YOK

**Proposal'da Şevval'in sorumlulukları:**
> "Interaction Ingestion Service, Message Broker Integration, **Transactional Outbox Pattern**, Idempotency Management."

Outbox pattern nedir? RabbitMQ'ya yazarken aynı anda bir DB tablosuna da kayıt atılır. Eğer servis çökmesi olursa, DB'deki kayıtlar tekrar publish edilebilir. Şu an Go servisi doğrudan RabbitMQ'ya yazıyor — araya DB yok, çökme anında mesaj kaybolabilir.

---

### 6. Saga Pattern — YOK

**Proposal'da Merve'nin sorumlulukları:**
> "Graph Updater & Weighting Service, Neo4j Graph Modeling, **Saga Pattern**, Recommendation Engine, Kubernetes Deployment."

Saga pattern, dağıtık işlemlerde tutarlılığı sağlar. Örneğin Neo4j güncellemesi başarısız olursa telafi işlemi (compensating transaction) tetiklenir. Şu an graph-updater sadece hata logluyor, geri alma mekanizması yok.

---

### 7. Kubernetes Deployment — YOK

**Proposal'da Merve'nin sorumlulukları:**
> "Kubernetes Deployment"

Sadece `docker-compose.yml` var. Kubernetes manifest dosyaları (Deployment, Service, ConfigMap, Secret YAML'ları) hiç oluşturulmamış.

---

## 🟠 Küçük Eksiklikler / Tutarsızlıklar

---

### 8. Weight Delta Değeri Tutarsızlığı

**Proposal (§5.4):**
> "Click events: increments the edge weight by the configured delta **(e.g., +10)**."

**Mevcut kod:**
```typescript
weightDelta = 0.1;  // Proposal +10 diyor, kod 0.1 kullanıyor
```

`+10` makul değil (sınır kontrolü olmadan hızla patlar), `0.1` mantıklı. Ama proposal ile tutarsız — ya proposal güncellenmeli ya da kodda bir açıklama olmalı.

---

### 9. feed-recommendation PORT Hardcoded

```typescript
const PORT = 3003; // .env'deki 3000'i ezmek için doğrudan 3003 verdik
```

Hızlı çözüm bırakılmış. `process.env.PORT || 3003` olmalı.

---

### 10. feed-recommendation Fallback userId Güvenlik Riski

```typescript
const userId = req.headers['x-user-uuid'] as string || 'test-user-uuid-1234';
```

API Gateway bypass edilip direkte `/api/feed`'e istek gönderilirse test kullanıcısının feed'i dönüyor. `x-user-uuid` yoksa `500` fırlatmalı.

---

## 📊 Tamamlanma Durumu (Proposal'a Göre)

```
API Gateway              ████████░░  80%  ✅ JWT + routing tam
Interaction Ingestion    ███████░░░  70%  ⚠️  Impression event tipi eksik
Graph Updater (DIW)      █████░░░░░  50%  ⚠️  Fatigue Penalty Score eksik
Feed Recommendation      ██████░░░░  60%  ⚠️  Hardcoded port, fallback userId
User Profile Service     ████░░░░░░  40%  ❌  CRUD yok, sadece stub
Prometheus + Grafana     ░░░░░░░░░░   0%  ❌  Hiç başlanmamış
Kubernetes               ░░░░░░░░░░   0%  ❌  Hiç başlanmamış
Saga Pattern             ░░░░░░░░░░   0%  ❌  Hiç başlanmamış
Transactional Outbox     ░░░░░░░░░░   0%  ❌  Hiç başlanmamış
```

---

## 🎯 Önerilen Öncelik Sırası

Eğer submission yakınsa bu sırayla ilerlenmeli:

1. **Impression event + Fatigue Penalty** — Projenin çekirdeği olan DIW algoritmasının yarısı eksik. Direkt nota yansır.
2. **Prometheus + Grafana** — Technology Stack tablosunda listelenmiş, tamamen yok. Gözlemlenebilirlik olmadan distributed system tamamlanmış sayılmaz.
3. **User Profile Service CRUD** — Şu an PostgreSQL bağlantısı var ama hiç kullanılmıyor. En az `GET /users/:id` ve `POST /users` eklenebilir.
4. **Transactional Outbox + Saga** — Daha karmaşık pattern'lar, zaman varsa.
5. **Kubernetes** — En zaman alan kısım, deadline'a göre değerlendir.
