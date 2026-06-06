package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/go-redis/redis/v8"
	amqp "github.com/rabbitmq/amqp091-go"
)

var ctx = context.Background()

// Gelen etkileşim verisinin yapısı
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

	// RabbitMQ Kanalı Oluştur
	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("Failed to open a channel: %v", err)
	}
	defer ch.Close()

	// Kuyruğu Tanımla
	q, err := ch.QueueDeclare(
		"interaction_events", // Kuyruk adı
		true,                 // Durable (Kalıcı)
		false,                // Delete when unused
		false,                // Exclusive
		false,                // No-wait
		nil,                  // Arguments
	)
	if err != nil {
		log.Fatalf("Failed to declare a queue: %v", err)
	}

	// 3. HTTP Sunucusu
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Zero-Trust: API Gateway'in eklediği header
		userUUID := r.Header.Get("x-user-uuid")
		if userUUID == "" {
			userUUID = "test-user-uuid-1234" // Test için fallback
		}

		// Sadece POST isteklerini kabul et
		if r.Method == http.MethodPost {
			var interaction Interaction
			err := json.NewDecoder(r.Body).Decode(&interaction)
			if err != nil {
				http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
				return
			}

			// Güvenlik: Header'dan gelen UserID'yi ezici olarak kullan
			interaction.UserID = userUUID

			// JSON formatına geri çevir
			body, err := json.Marshal(interaction)
			if err != nil {
				http.Error(w, "Failed to encode message", http.StatusInternalServerError)
				return
			}

			// RabbitMQ'ya gönder (Publish)
			err = ch.Publish(
				"",     // Exchange
				q.Name, // Routing key (kuyruk adı)
				false,  // Mandatory
				false,  // Immediate
				amqp.Publishing{
					ContentType: "application/json",
					Body:        body,
				})
			if err != nil {
				http.Error(w, "Failed to publish a message", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "Interaction recorded and sent to queue")
			return
		}

		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "Interaction Ingestion Service is running. Authenticated User: %s", userUUID)
	})

	port := ":3002"
	fmt.Printf("Interaction Ingestion Service started on http://localhost%s\n", port)

	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
