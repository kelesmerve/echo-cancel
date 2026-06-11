package model

import "time"

// Interaction represents the incoming payload
type Interaction struct {
	UserID   string `json:"userId"`
	Category string `json:"category"`
	Action   string `json:"action"`
}

// OutboxEvent represents a row in our PostgreSQL outbox table
type OutboxEvent struct {
	ID        int       `json:"id"`
	Payload   string    `json:"payload"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
}
