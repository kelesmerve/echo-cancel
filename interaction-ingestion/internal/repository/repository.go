package repository

import (
	"context"
	"database/sql"
	"time"

	"interaction-ingestion/internal/model"

	"github.com/go-redis/redis/v8"
	_ "github.com/lib/pq"
)

type Repository struct {
	db  *sql.DB
	rdb *redis.Client
}

func NewRepository(db *sql.DB, rdb *redis.Client) *Repository {
	return &Repository{db: db, rdb: rdb}
}

// InitSchema creates the outbox table if it doesn't exist
func (r *Repository) InitSchema() error {
	query := `
	CREATE TABLE IF NOT EXISTS outbox_events (
		id SERIAL PRIMARY KEY,
		payload JSONB NOT NULL,
		status VARCHAR(20) DEFAULT 'PENDING',
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`
	_, err := r.db.Exec(query)
	return err
}

// CheckIdempotency attempts to set a key in Redis. Returns true if new, false if exists.
func (r *Repository) CheckIdempotency(ctx context.Context, key string) (bool, error) {
	redisKey := "idempotency:" + key
	return r.rdb.SetNX(ctx, redisKey, "processed", 24*time.Hour).Result()
}

// ClearIdempotency removes the key if something fails down the line
func (r *Repository) ClearIdempotency(ctx context.Context, key string) {
	r.rdb.Del(ctx, "idempotency:"+key)
}

// SaveOutboxEvent writes the event to Postgres
func (r *Repository) SaveOutboxEvent(ctx context.Context, payload string) error {
	query := `INSERT INTO outbox_events (payload, status) VALUES ($1, 'PENDING')`
	_, err := r.db.ExecContext(ctx, query, payload)
	return err
}

// GetPendingEvents fetches events that haven't been published yet
func (r *Repository) GetPendingEvents(ctx context.Context, limit int) ([]model.OutboxEvent, error) {
	query := `SELECT id, payload::text, status, created_at FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT $1`
	rows, err := r.db.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []model.OutboxEvent
	for rows.Next() {
		var e model.OutboxEvent
		if err := rows.Scan(&e.ID, &e.Payload, &e.Status, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

// MarkEventPublished updates the status
func (r *Repository) MarkEventPublished(ctx context.Context, id int) error {
	query := `UPDATE outbox_events SET status = 'PUBLISHED' WHERE id = $1`
	_, err := r.db.ExecContext(ctx, query, id)
	return err
}
