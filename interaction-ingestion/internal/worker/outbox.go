package worker

import (
	"context"
	"log"
	"time"

	"interaction-ingestion/internal/repository"

	amqp "github.com/rabbitmq/amqp091-go"
)

type OutboxWorker struct {
	repo     *repository.Repository
	channel  *amqp.Channel
	exchange string
}

func NewOutboxWorker(repo *repository.Repository, channel *amqp.Channel, exchange string) *OutboxWorker {
	return &OutboxWorker{
		repo:     repo,
		channel:  channel,
		exchange: exchange,
	}
}

// Start begins the polling loop
func (w *OutboxWorker) Start(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second) // Poll every 2 seconds
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Println("Stopping outbox worker")
			return
		case <-ticker.C:
			w.processPendingEvents(ctx)
		}
	}
}

func (w *OutboxWorker) processPendingEvents(ctx context.Context) {
	// Fetch up to 50 pending events at a time
	events, err := w.repo.GetPendingEvents(ctx, 50)
	if err != nil {
		log.Printf("[Worker] Error fetching outbox events: %v", err)
		return
	}

	for _, event := range events {
		err := w.channel.Publish(
			w.exchange,
			"interaction.new",
			false,
			false,
			amqp.Publishing{
				ContentType: "application/json",
				Body:        []byte(event.Payload),
			})

		if err != nil {
			log.Printf("[Worker] Failed to publish event ID %d: %v", event.ID, err)
			continue // Skip to next, will retry next tick
		}

		// Mark as published only if RabbitMQ accepted it
		err = w.repo.MarkEventPublished(ctx, event.ID)
		if err != nil {
			log.Printf("[Worker] Failed to update status for event ID %d: %v", event.ID, err)
		} else {
			log.Printf("[Worker] Successfully published event ID %d", event.ID)
		}
	}
}
