package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-redis/redis/v8"
	amqp "github.com/rabbitmq/amqp091-go"
)

var ctx = context.Background()

// Backpressure için maksimum eşzamanlı istek limiti
const maxConcurrentRequests = 100

var semaphore = make(chan struct{}, maxConcurrentRequests)

type Interaction struct {
	UserID   string `json:"userId"`
	Category string `json:"category"`
	Action   string `json:"action"`
}

func main() {
	// 1. Redis Bağlantısı
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		log.Fatalf("Redis connection error: %v", err)
	}
	fmt.Println("Redis connected successfully")

	// 2. RabbitMQ Bağlantısı
	rabbitURL := os.Getenv("RABBITMQ_URL")
	if rabbitURL == "" {
		rabbitURL = "amqp://guest:guest@localhost:5672/"
	}

	conn, err := amqp.Dial(rabbitURL)
	if err != nil {
		log.Fatalf("RabbitMQ connection error: %v", err)
	}
	defer conn.Close()
	fmt.Println("RabbitMQ connected successfully")

	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("Failed to open a channel: %v", err)
	}
	defer ch.Close()

	q, err := ch.QueueDeclare(
		"interaction_events",
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		log.Fatalf("Failed to declare a queue: %v", err)
	}

	// 3. HTTP Sunucusu
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Backpressure Kontrolü
		select {
		case semaphore <- struct{}{}:
			// İşlem bitince semaforu serbest bırak
			defer func() { <-semaphore }()
		default:
			// Semafor doluysa (Sistem aşırı yüklü) 503 dön
			http.Error(w, "Service Unavailable - System Overloaded", http.StatusServiceUnavailable)
			return
		}

		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "Interaction Ingestion Service is running.")
			return
		}

		// Zero-Trust User ID Kontrolü
		userUUID := r.Header.Get("x-user-uuid")
		if userUUID == "" {
			http.Error(w, "Unauthorized: Missing user UUID", http.StatusUnauthorized)
			return
		}

		// Idempotency Key Kontrolü
		idempotencyKey := r.Header.Get("Idempotency-Key")
		if idempotencyKey == "" {
			http.Error(w, "Bad Request: Missing Idempotency-Key header", http.StatusBadRequest)
			return
		}

		// Redis üzerinden Idempotency kontrolü (24 saat TTL)
		redisKey := "idempotency:" + idempotencyKey
		exists, err := rdb.SetNX(ctx, redisKey, "processed", 24*time.Hour).Result()
		if err != nil {
			http.Error(w, "Internal Server Error: Redis check failed", http.StatusInternalServerError)
			return
		}

		if !exists {
			// Key zaten var. İstek daha önce işlenmiş (Duplicate).
			// RabbitMQ'ya tekrar yazmadan başarılı yanıt dönüyoruz.
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "Interaction already processed (Idempotent response)")
			return
		}

		// JSON Parse İşlemi
		var interaction Interaction
		err = json.NewDecoder(r.Body).Decode(&interaction)
		if err != nil {
			// Hatalı veri durumunda Redis kaydını sil ki sistem düzeltilip tekrar denenebilsin
			rdb.Del(ctx, redisKey)
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}

		interaction.UserID = userUUID

		body, err := json.Marshal(interaction)
		if err != nil {
			rdb.Del(ctx, redisKey)
			http.Error(w, "Failed to encode message", http.StatusInternalServerError)
			return
		}

		// RabbitMQ'ya gönder (Publish)
		err = ch.Publish(
			"",
			q.Name,
			false,
			false,
			amqp.Publishing{
				ContentType: "application/json",
				Body:        body,
			})
		if err != nil {
			// RabbitMQ'ya yazılamazsa Redis kaydını sil
			rdb.Del(ctx, redisKey)
			http.Error(w, "Failed to publish a message", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Interaction recorded and sent to queue")
	})

	port := ":3002"
	fmt.Printf("Interaction Ingestion Service started on http://localhost%s\n", port)

	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
