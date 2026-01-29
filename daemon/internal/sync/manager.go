package sync

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"pkb-daemon/internal/api"
	"pkb-daemon/internal/config"
	"pkb-daemon/internal/sources/calendar"
	"pkb-daemon/internal/sources/contacts"
	"pkb-daemon/internal/sources/notes"
)

// Source is the interface for communication sources (incremental sync)
type Source interface {
	Name() string
	Sync(ctx context.Context, checkpoint string, limit int) ([]api.Communication, string, error)
}

// ContactsSource is the interface for contact sources (full sync)
type ContactsSource interface {
	Name() string
	SyncContacts(ctx context.Context) ([]contacts.ContactImport, error)
}

// CalendarSource is the interface for calendar sources
type CalendarSource interface {
	Name() string
	Sync(ctx context.Context, checkpoint string) ([]calendar.CalendarEvent, string, error)
}

// NotesSource is the interface for notes sources (incremental sync)
type NotesSource interface {
	Name() string
	Sync(ctx context.Context, checkpoint string, limit int) ([]notes.NoteImport, string, error)
}

type Manager struct {
	client          *api.Client
	config          *config.Config
	state           *State
	sources         []Source
	contactsSources []ContactsSource
	calendarSources []CalendarSource
	notesSources    []NotesSource
}

func NewManager(client *api.Client, cfg *config.Config) *Manager {
	return &Manager{
		client:          client,
		config:          cfg,
		state:           NewState(cfg.State.Path),
		sources:         []Source{},
		contactsSources: []ContactsSource{},
		calendarSources: []CalendarSource{},
		notesSources:    []NotesSource{},
	}
}

func (m *Manager) RegisterSource(src Source) {
	m.sources = append(m.sources, src)
	log.Info().Str("source", src.Name()).Msg("Registered communication source")
}

func (m *Manager) RegisterContactsSource(src ContactsSource) {
	m.contactsSources = append(m.contactsSources, src)
	log.Info().Str("source", src.Name()).Msg("Registered contacts source")
}

func (m *Manager) RegisterCalendarSource(src CalendarSource) {
	m.calendarSources = append(m.calendarSources, src)
	log.Info().Str("source", src.Name()).Msg("Registered calendar source")
}

func (m *Manager) RegisterNotesSource(src NotesSource) {
	m.notesSources = append(m.notesSources, src)
	log.Info().Str("source", src.Name()).Msg("Registered notes source")
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
	// Sync communication sources
	for _, src := range m.sources {
		if err := m.syncSource(ctx, src); err != nil {
			log.Error().Err(err).Str("source", src.Name()).Msg("Sync failed")
		}
	}

	// Sync contacts sources
	for _, src := range m.contactsSources {
		if err := m.syncContactsSource(ctx, src); err != nil {
			log.Error().Err(err).Str("source", src.Name()).Msg("Contacts sync failed")
		}
	}

	// Sync calendar sources
	for _, src := range m.calendarSources {
		if err := m.syncCalendarSource(ctx, src); err != nil {
			log.Error().Err(err).Str("source", src.Name()).Msg("Calendar sync failed")
		}
	}

	// Sync notes sources
	for _, src := range m.notesSources {
		if err := m.syncNotesSource(ctx, src); err != nil {
			log.Error().Err(err).Str("source", src.Name()).Msg("Notes sync failed")
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

func (m *Manager) syncContactsSource(ctx context.Context, src ContactsSource) error {
	// Contacts do a full sync each time (no incremental checkpoint)
	imports, err := src.SyncContacts(ctx)
	if err != nil {
		return err
	}

	if len(imports) == 0 {
		return nil
	}

	// Convert to API format
	apiImports := make([]api.ContactImport, len(imports))
	for i, imp := range imports {
		facts := make([]api.ContactFact, len(imp.Facts))
		for j, f := range imp.Facts {
			facts[j] = api.ContactFact{Type: f.Type, Value: f.Value}
		}
		apiImports[i] = api.ContactImport{
			SourceID:    imp.SourceID,
			DisplayName: imp.DisplayName,
			Emails:      imp.Emails,
			Phones:      imp.Phones,
			Facts:       facts,
			Note:        imp.Note,
		}
	}

	// Send to backend
	result, err := m.client.ImportContacts(apiImports)
	if err != nil {
		return err
	}

	log.Info().
		Str("source", src.Name()).
		Int("created", result.Created).
		Int("updated", result.Updated).
		Int("merged", result.Merged).
		Int("errors", len(result.Errors)).
		Msg("Contacts synced")

	return nil
}

func (m *Manager) syncCalendarSource(ctx context.Context, src CalendarSource) error {
	checkpoint := m.state.GetCheckpoint(src.Name())

	events, newCheckpoint, err := src.Sync(ctx, checkpoint)
	if err != nil {
		return err
	}

	if len(events) == 0 {
		return nil
	}

	// For now, log calendar events - full integration would require backend endpoint
	log.Info().
		Str("source", src.Name()).
		Int("events", len(events)).
		Msg("Calendar events fetched")

	// Update checkpoint
	m.state.SetCheckpoint(src.Name(), newCheckpoint)
	if err := m.state.Save(); err != nil {
		log.Warn().Err(err).Msg("Failed to save state")
	}

	return nil
}

func (m *Manager) syncNotesSource(ctx context.Context, src NotesSource) error {
	checkpoint := m.state.GetCheckpoint(src.Name())
	totalSynced := 0

	for totalSynced < m.config.Sync.MaxPerCycle {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		noteImports, newCheckpoint, err := src.Sync(ctx, checkpoint, m.config.Sync.BatchSize)
		if err != nil {
			return err
		}

		if len(noteImports) == 0 {
			break
		}

		// For now, log notes - full integration would require backend endpoint
		log.Info().
			Str("source", src.Name()).
			Int("notes", len(noteImports)).
			Msg("Notes fetched")

		// Update checkpoint
		checkpoint = newCheckpoint
		m.state.SetCheckpoint(src.Name(), checkpoint)
		if err := m.state.Save(); err != nil {
			log.Warn().Err(err).Msg("Failed to save state")
		}

		totalSynced += len(noteImports)

		if len(noteImports) < m.config.Sync.BatchSize {
			break
		}
	}

	return nil
}
