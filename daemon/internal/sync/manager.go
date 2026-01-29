package sync

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"pkb-daemon/internal/api"
	"pkb-daemon/internal/config"
)

type Source interface {
	Name() string
	Sync(ctx context.Context, checkpoint string, limit int) ([]api.Communication, string, error)
}

type Manager struct {
	client  *api.Client
	config  *config.Config
	state   *State
	sources []Source
}

func NewManager(client *api.Client, cfg *config.Config) *Manager {
	return &Manager{
		client:  client,
		config:  cfg,
		state:   NewState(cfg.State.Path),
		sources: []Source{},
	}
}

func (m *Manager) RegisterSource(src Source) {
	m.sources = append(m.sources, src)
	log.Info().Str("source", src.Name()).Msg("Registered source")
}

func (m *Manager) Run(ctx context.Context) error {
	// Load saved state
	if err := m.state.Load(); err != nil {
		log.Warn().Err(err).Msg("Failed to load state, starting fresh")
	}

	ticker := time.NewTicker(time.Duration(m.config.Sync.IntervalSeconds) * time.Second)
	defer ticker.Stop()

	// Initial sync
	m.syncAll(ctx)

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			m.syncAll(ctx)
		}
	}
}

func (m *Manager) syncAll(ctx context.Context) {
	for _, src := range m.sources {
		if err := m.syncSource(ctx, src); err != nil {
			log.Error().Err(err).Str("source", src.Name()).Msg("Sync failed")
		}
	}
}

func (m *Manager) syncSource(ctx context.Context, src Source) error {
	checkpoint := m.state.GetCheckpoint(src.Name())
	totalSynced := 0

	for totalSynced < m.config.Sync.MaxPerCycle {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Get batch from source
		comms, newCheckpoint, err := src.Sync(ctx, checkpoint, m.config.Sync.BatchSize)
		if err != nil {
			return err
		}

		if len(comms) == 0 {
			break
		}

		// Send to backend
		result, err := m.client.BatchUpsert(comms)
		if err != nil {
			return err
		}

		log.Info().
			Str("source", src.Name()).
			Int("inserted", result.Inserted).
			Int("updated", result.Updated).
			Int("errors", len(result.Errors)).
			Msg("Batch synced")

		// Update checkpoint
		checkpoint = newCheckpoint
		m.state.SetCheckpoint(src.Name(), checkpoint)
		if err := m.state.Save(); err != nil {
			log.Warn().Err(err).Msg("Failed to save state")
		}

		totalSynced += len(comms)

		if len(comms) < m.config.Sync.BatchSize {
			break // No more messages
		}
	}

	return nil
}
