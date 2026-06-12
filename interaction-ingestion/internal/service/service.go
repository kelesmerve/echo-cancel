package service

import (
	"context"
	"encoding/json"
	"errors"
	"interaction-ingestion/internal/model"
	"interaction-ingestion/internal/repository"
)

type InteractionService struct {
	repo *repository.Repository
}

func NewInteractionService(repo *repository.Repository) *InteractionService {
	return &InteractionService{repo: repo}
}

// Process handles validation, idempotency, and saving to the outbox.
func (s *InteractionService) Process(ctx context.Context, idempotencyKey string, interaction model.Interaction) (bool, error) {
	// 1. Validation (Added missing feature from proposal)
	if interaction.Action != "click" && interaction.Action != "like" && interaction.Action != "skip" && interaction.Action != "impression" {
		return false, errors.New("invalid action type")
	}

	// 2. Idempotency Check
	isNew, err := s.repo.CheckIdempotency(ctx, idempotencyKey)
	if err != nil {
		return false, err
	}
	if !isNew {
		return false, nil // Not an error, just a duplicate. We return false so handler knows it's a duplicate.
	}

	// 3. Serialize and save to Outbox
	payloadBytes, err := json.Marshal(interaction)
	if err != nil {
		s.repo.ClearIdempotency(ctx, idempotencyKey)
		return false, err
	}

	err = s.repo.SaveOutboxEvent(ctx, string(payloadBytes))
	if err != nil {
		s.repo.ClearIdempotency(ctx, idempotencyKey)
		return false, err
	}

	return true, nil // Success
}
