package sync

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"

	"pkb-daemon/internal/api"
	"pkb-daemon/internal/config"
	"pkb-daemon/internal/queue"
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
	queue           *queue.Queue
	queueProcessor  *queue.Processor
	sources         []Source
	contactsSources []ContactsSource
	calendarSources []CalendarSource
	notesSources    []NotesSource
}

func NewManager(client *api.Client, cfg *config.Config) *Manager {
	m := &Manager{
		client:          client,
		config:          cfg,
		state:           NewState(cfg.State.Path),
		sources:         []Source{},
		contactsSources: []ContactsSource{},
		calendarSources: []CalendarSource{},
		notesSources:    []NotesSource{},
	}
	return m
}

// InitQueue initializes the offline queue system
func (m *Manager) InitQueue() error {
	if !m.config.Queue.Enabled {
		log.Info().Msg("Offline queue disabled")
		return nil
	}

	queueCfg := queue.Config{
		Path:           m.config.Queue.Path,
		MaxRetries:     m.config.Queue.MaxRetries,
		InitialBackoff: time.Duration(m.config.Queue.InitialBackoffSecs) * time.Second,
		MaxBackoff:     time.Duration(m.config.Queue.MaxBackoffSecs) * time.Second,
		BackoffFactor:  m.config.Queue.BackoffFactor,
	}

	q, err := queue.New(queueCfg)
	if err != nil {
		return err
	}
	m.queue = q

	// Create processor with handler that routes to appropriate API methods
	procCfg := queue.ProcessorConfig{
		CheckInterval: time.Duration(m.config.Queue.ProcessIntervalSecs) * time.Second,
		BatchSize:     m.config.Queue.BatchSize,
	}

	m.queueProcessor = queue.NewProcessor(q, m.handleQueuedRequest, procCfg)

	// Set online checker to use health check
	m.queueProcessor.SetOnlineChecker(func() bool {
		err := m.client.HealthCheck()
		return err == nil
	})

	log.Info().
		Str("path", m.config.Queue.Path).
		Int("max_retries", m.config.Queue.MaxRetries).
		Msg("Offline queue initialized")

	// Log queue stats
	if stats, err := m.queue.Stats(); err == nil && stats.PendingCount > 0 {
		log.Info().
			Int64("pending", stats.PendingCount).
			Int64("expired", stats.ExpiredCount).
			Msg("Queued requests from previous session")
	}

	return nil
}

// handleQueuedRequest processes a request from the queue
func (m *Manager) handleQueuedRequest(reqType queue.RequestType, payload []byte) error {
	switch reqType {
	case queue.RequestTypeBatchUpsert:
		return m.client.BatchUpsertFromPayload(payload)
	case queue.RequestTypeImportContacts:
		return m.client.ImportContactsFromPayload(payload)
	case queue.RequestTypeImportCalendar:
		return m.client.ImportCalendarEventsFromPayload(payload)
	case queue.RequestTypeImportNotes:
		return m.client.ImportAppleNotesFromPayload(payload)
	default:
		log.Warn().Str("type", string(reqType)).Msg("Unknown queued request type")
		return nil // Don't retry unknown types
	}
}

// enqueueOnError queues a failed request if the queue is enabled and the error is temporary
func (m *Manager) enqueueOnError(reqType queue.RequestType, payload interface{}, err error) {
	if m.queue == nil {
		return
	}

	if !api.IsTemporaryError(err) {
		log.Debug().
			Str("type", string(reqType)).
			Err(err).
			Msg("Not queuing permanent error")
		return
	}

	if queueErr := m.queue.Enqueue(reqType, payload, err.Error()); queueErr != nil {
		log.Error().
			Err(queueErr).
			Str("type", string(reqType)).
			Msg("Failed to queue request for retry")
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

	// Start queue processor in background if enabled
	if m.queueProcessor != nil {
		go m.queueProcessor.Run(ctx)
	}

	ticker := time.NewTicker(time.Duration(m.config.Sync.IntervalSeconds) * time.Second)
	defer ticker.Stop()

	// Initial sync
	m.syncAll(ctx)

	for {
		select {
		case <-ctx.Done():
			// Close queue on shutdown
			if m.queue != nil {
				if err := m.queue.Close(); err != nil {
					log.Error().Err(err).Msg("Failed to close queue")
				}
			}
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
			// Queue the failed request for retry
			m.enqueueOnError(queue.RequestTypeBatchUpsert, api.BatchUpsertRequest{Communications: comms}, err)

			// If it's a temporary error, we should stop this sync cycle
			// but still update checkpoint so we don't re-fetch the same data
			if api.IsTemporaryError(err) {
				log.Warn().
					Err(err).
					Str("source", src.Name()).
					Int("count", len(comms)).
					Msg("Batch queued for retry due to temporary error")

				// Update checkpoint even on failure to avoid re-fetching
				checkpoint = newCheckpoint
				m.state.SetCheckpoint(src.Name(), checkpoint)
				if saveErr := m.state.Save(); saveErr != nil {
					log.Warn().Err(saveErr).Msg("Failed to save state")
				}
				return err
			}
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

	// Send in batches of 50 to avoid payload size issues
	const batchSize = 50
	totalCreated, totalUpdated, totalMerged, totalErrors := 0, 0, 0, 0

	for i := 0; i < len(apiImports); i += batchSize {
		end := i + batchSize
		if end > len(apiImports) {
			end = len(apiImports)
		}
		batch := apiImports[i:end]

		result, err := m.client.ImportContacts(batch)
		if err != nil {
			m.enqueueOnError(queue.RequestTypeImportContacts, api.ContactsImportRequest{Contacts: batch}, err)
			if api.IsTemporaryError(err) {
				log.Warn().
					Err(err).
					Str("source", src.Name()).
					Int("count", len(batch)).
					Msg("Contacts batch queued for retry")
			}
			continue
		}

		totalCreated += result.Created
		totalUpdated += result.Updated
		totalMerged += result.Merged
		totalErrors += len(result.Errors)

		// Log individual errors for debugging
		for _, e := range result.Errors {
			contactName := ""
			if e.Index >= 0 && e.Index < len(batch) {
				contactName = batch[e.Index].DisplayName
			}
			log.Warn().
				Int("index", e.Index).
				Str("contact", contactName).
				Str("error", e.Error).
				Msg("Contact import error")
		}
	}

	log.Info().
		Str("source", src.Name()).
		Int("created", totalCreated).
		Int("updated", totalUpdated).
		Int("merged", totalMerged).
		Int("errors", totalErrors).
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

	// Convert to API format
	apiEvents := make([]api.CalendarEventImport, len(events))
	for i, event := range events {
		apiEvents[i] = api.CalendarEventImport{
			SourceID:    event.SourceID,
			Provider:    event.Provider,
			Title:       event.Title,
			Description: event.Description,
			Location:    event.Location,
			StartTime:   event.StartTime.Format("2006-01-02T15:04:05Z07:00"),
			AllDay:      event.AllDay,
			Attendees:   event.Attendees,
			CalendarID:  event.CalendarID,
		}
		if !event.EndTime.IsZero() {
			apiEvents[i].EndTime = event.EndTime.Format("2006-01-02T15:04:05Z07:00")
		}
	}

	// Send to backend
	result, err := m.client.ImportCalendarEvents(apiEvents)
	if err != nil {
		// Queue for retry if it's a temporary error
		m.enqueueOnError(queue.RequestTypeImportCalendar, api.CalendarEventsRequest{Events: apiEvents}, err)

		if api.IsTemporaryError(err) {
			log.Warn().
				Err(err).
				Str("source", src.Name()).
				Int("count", len(apiEvents)).
				Msg("Calendar events queued for retry due to temporary error")
		}
		return err
	}

	log.Info().
		Str("source", src.Name()).
		Int("inserted", result.Inserted).
		Int("updated", result.Updated).
		Int("errors", len(result.Errors)).
		Msg("Calendar events synced")

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

		// Convert to API format
		apiNotes := make([]api.AppleNoteImport, len(noteImports))
		for i, note := range noteImports {
			apiNotes[i] = api.AppleNoteImport{
				SourceID: note.SourceID,
				Title:    note.Title,
				Content:  note.Content,
				Folder:   note.Folder,
			}
			if !note.CreatedAt.IsZero() {
				apiNotes[i].CreatedAt = note.CreatedAt.Format("2006-01-02T15:04:05Z07:00")
			}
			if !note.UpdatedAt.IsZero() {
				apiNotes[i].UpdatedAt = note.UpdatedAt.Format("2006-01-02T15:04:05Z07:00")
			}
		}

		// Send to backend
		result, err := m.client.ImportAppleNotes(apiNotes)
		if err != nil {
			// Queue for retry if it's a temporary error
			m.enqueueOnError(queue.RequestTypeImportNotes, api.AppleNotesRequest{Notes: apiNotes}, err)

			if api.IsTemporaryError(err) {
				log.Warn().
					Err(err).
					Str("source", src.Name()).
					Int("count", len(apiNotes)).
					Msg("Notes queued for retry due to temporary error")

				// Update checkpoint even on failure to avoid re-fetching
				checkpoint = newCheckpoint
				m.state.SetCheckpoint(src.Name(), checkpoint)
				if saveErr := m.state.Save(); saveErr != nil {
					log.Warn().Err(saveErr).Msg("Failed to save state")
				}
			}
			return err
		}

		log.Info().
			Str("source", src.Name()).
			Int("inserted", result.Inserted).
			Int("updated", result.Updated).
			Int("errors", len(result.Errors)).
			Msg("Notes synced")

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
