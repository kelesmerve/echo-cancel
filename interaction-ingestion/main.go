package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	"interaction-ingestion/internal/model"
	"interaction-ingestion/internal/repository"
	"interaction-ingestion/internal/service"
	"interaction-ingestion/internal/worker"

	"github.com/go-redis/redis/v8"
	amqp "github.com/rabbitmq/amqp091-go"
)

var ctx = context.Background()

const maxConcurrentRequests = 100

var semaphore = make(chan struct{}, maxConcurrentRequests)

func main() {
	// 1. PostgreSQL Connection (Connecting to ingestion_db on port 5434)
	pgConnStr := os.Getenv("PG_URL")
	if pgConnStr == "" {
		pgConnStr = "postgres://admin:password123@localhost:5434/ingestion_db?sslmode=disable"
	}
	db, err := sql.Open("postgres", pgConnStr)
	if err != nil {
		log.Fatalf("Failed to open Postgres: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("Failed to connect to Postgres: %v", err)
	}
	fmt.Println("PostgreSQL connected successfully")

	// 2. Redis Connection (Using DB 0 for Idempotency)
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr, DB: 0})
	if _, err := rdb.Ping(ctx).Result(); err != nil {
		log.Fatalf("Redis connection error: %v", err)
	}
	fmt.Println("Redis connected successfully")

	// 3. RabbitMQ Connection
	rabbitURL := os.Getenv("RABBITMQ_URL")
	if rabbitURL == "" {
		rabbitURL = "amqp://guest:guest@localhost:5672/"
	}
	conn, err := amqp.Dial(rabbitURL)
	if err != nil {
		log.Fatalf("RabbitMQ connection error: %v", err)
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		log.Fatalf("Failed to open RMQ channel: %v", err)
	}
	defer ch.Close()

	q, err := ch.QueueDeclare("interaction_events", true, false, false, false, nil)
	if err != nil {
		log.Fatalf("Failed to declare queue: %v", err)
	}
	fmt.Println("RabbitMQ connected successfully")

	// 4. Wire the Architecture Layers together
	repo := repository.NewRepository(db, rdb)
	err = repo.InitSchema() // Ensure outbox table exists
	if err != nil {
		log.Fatalf("Failed to initialize database schema: %v", err)
	}

	interactionService := service.NewInteractionService(repo)
	outboxWorker := worker.NewOutboxWorker(repo, ch, q.Name)

	// Start the Background Worker in a separate goroutine
	go outboxWorker.Start(ctx)

	// 5. HTTP Handler
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Backpressure
		select {
		case semaphore <- struct{}{}:
			defer func() { <-semaphore }()
		default:
			http.Error(w, "Service Unavailable - System Overloaded", http.StatusServiceUnavailable)
			return
		}

		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, "Interaction Ingestion Service is running with Outbox Pattern.")
			return
		}

		userUUID := r.Header.Get("x-user-uuid")
		if userUUID == "" {
			http.Error(w, "Unauthorized: Missing user UUID", http.StatusUnauthorized)
			return
		}

		idempotencyKey := r.Header.Get("Idempotency-Key")
		if idempotencyKey == "" {
			http.Error(w, "Bad Request: Missing Idempotency-Key header", http.StatusBadRequest)
			return
		}

		var interaction model.Interaction
		if err := json.NewDecoder(r.Body).Decode(&interaction); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}
		interaction.UserID = userUUID

		// Pass to Service Layer
		isNew, err := interactionService.Process(ctx, idempotencyKey, interaction)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.WriteHeader(http.StatusOK)
		if !isNew {
			fmt.Fprintf(w, "Interaction already processed (Idempotent response)")
		} else {
			fmt.Fprintf(w, "Interaction securely recorded to Outbox")
		}
	})

	port := ":3002"
	fmt.Printf("Interaction Ingestion Service started on http://localhost%s\n", port)
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
