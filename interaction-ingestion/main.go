package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/go-redis/redis/v8"
	amqp "github.com/rabbitmq/amqp091-go"
)

var ctx = context.Background()

func main() {
	// Redis adresini ortam değişkeninden al
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	// 1. Redis Bağlantısı (Idempotency için)
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	_, err := rdb.Ping(ctx).Result()
	if err != nil {
		log.Fatalf("Redis connection error: %v", err)
	}
	fmt.Println("Redis connected successfully")

	// 2. RabbitMQ Bağlantısı (Asenkron mesajlaşma için)
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

	// 3. HTTP Sunucusu (API Gateway üzerinden gelen istekleri karşılar)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Zero-Trust: API Gateway'in eklediği header
		userUUID := r.Header.Get("x-user-uuid")

		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Interaction Ingestion Service is running. Authenticated User: %s", userUUID)
	})

	port := ":3002"
	fmt.Printf("Interaction Ingestion Service started on http://localhost%s\n", port)

	// Sunucuyu başlat
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
