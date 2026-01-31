package queue

import (
	"context"
	"encoding/json"
	"time"

	"github.com/rs/zerolog/log"
)

// RequestHandler is a function that processes a queued request
// It receives the request type and payload, and returns an error if processing fails
type RequestHandler func(reqType RequestType, payload []byte) error

// Processor manages the background processing of queued requests
type Processor struct {
	queue          *Queue
	handler        RequestHandler
	checkInterval  time.Duration
	batchSize      int
	isOnline       bool
	onlineCheckFn  func() bool
}

// ProcessorConfig holds processor configuration
type ProcessorConfig struct {
	CheckInterval time.Duration // How often to check for pending requests
	BatchSize     int           // How many requests to process per cycle
}

// DefaultProcessorConfig returns sensible defaults
func DefaultProcessorConfig() ProcessorConfig {
	return ProcessorConfig{
		CheckInterval: 30 * time.Second,
		BatchSize:     10,
	}
}

// NewProcessor creates a new queue processor
func NewProcessor(queue *Queue, handler RequestHandler, cfg ProcessorConfig) *Processor {
	return &Processor{
		queue:         queue,
		handler:       handler,
		checkInterval: cfg.CheckInterval,
		batchSize:     cfg.BatchSize,
		isOnline:      true,
	}
}

// SetOnlineChecker sets a function that checks if the API is available
func (p *Processor) SetOnlineChecker(fn func() bool) {
	p.onlineCheckFn = fn
}

// Run starts the background processor
func (p *Processor) Run(ctx context.Context) {
	ticker := time.NewTicker(p.checkInterval)
	defer ticker.Stop()

	log.Info().
		Dur("interval", p.checkInterval).
		Int("batch_size", p.batchSize).
		Msg("Queue processor started")

	// Process any pending items immediately on start
	p.processQueue(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Info().Msg("Queue processor stopped")
			return
		case <-ticker.C:
			p.processQueue(ctx)
		}
	}
}

// processQueue processes pending requests from the queue
func (p *Processor) processQueue(ctx context.Context) {
	// Check if we're online first
	if p.onlineCheckFn != nil && !p.onlineCheckFn() {
		log.Debug().Msg("Skipping queue processing: API offline")
		return
	}

	// Purge expired requests first
	if _, err := p.queue.PurgeExpired(); err != nil {
		log.Error().Err(err).Msg("Failed to purge expired requests")
	}

	// Get pending requests
	requests, err := p.queue.GetPendingRequests(p.batchSize)
	if err != nil {
		log.Error().Err(err).Msg("Failed to get pending requests")
		return
	}

	if len(requests) == 0 {
		return
	}

	log.Info().Int("count", len(requests)).Msg("Processing queued requests")

	successCount := 0
	failCount := 0

	for _, req := range requests {
		select {
		case <-ctx.Done():
			return
		default:
		}

		err := p.handler(req.Type, req.Payload)
		if err != nil {
			log.Warn().
				Err(err).
				Int64("id", req.ID).
				Str("type", string(req.Type)).
				Int("retries", req.Retries+1).
				Msg("Queued request failed")

			if err := p.queue.MarkFailed(req.ID, err.Error()); err != nil {
				log.Error().Err(err).Int64("id", req.ID).Msg("Failed to mark request as failed")
			}
			failCount++
		} else {
			if err := p.queue.MarkSuccess(req.ID); err != nil {
				log.Error().Err(err).Int64("id", req.ID).Msg("Failed to mark request as success")
			}
			successCount++
		}
	}

	if successCount > 0 || failCount > 0 {
		log.Info().
			Int("success", successCount).
			Int("failed", failCount).
			Msg("Queue processing complete")
	}
}

// ProcessNow triggers immediate processing of the queue
func (p *Processor) ProcessNow(ctx context.Context) {
	p.processQueue(ctx)
}

// QueueStats returns current queue statistics
func (p *Processor) QueueStats() (*Stats, error) {
	return p.queue.Stats()
}

// UnmarshalPayload is a helper to unmarshal a queued request payload
func UnmarshalPayload[T any](payload []byte) (T, error) {
	var result T
	err := json.Unmarshal(payload, &result)
	return result, err
}
