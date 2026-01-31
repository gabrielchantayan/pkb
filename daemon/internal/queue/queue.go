package queue

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rs/zerolog/log"
)

// RequestType identifies the type of API request
type RequestType string

const (
	RequestTypeBatchUpsert      RequestType = "batch_upsert"
	RequestTypeImportContacts   RequestType = "import_contacts"
	RequestTypeImportCalendar   RequestType = "import_calendar"
	RequestTypeImportNotes      RequestType = "import_notes"
)

// QueuedRequest represents a failed API request stored in the queue
type QueuedRequest struct {
	ID          int64       `json:"id"`
	Type        RequestType `json:"type"`
	Payload     []byte      `json:"payload"`
	Retries     int         `json:"retries"`
	MaxRetries  int         `json:"max_retries"`
	NextRetryAt time.Time   `json:"next_retry_at"`
	CreatedAt   time.Time   `json:"created_at"`
	LastError   string      `json:"last_error"`
}

// Config holds queue configuration
type Config struct {
	Path           string        // Path to SQLite database file
	MaxRetries     int           // Maximum number of retries per request
	InitialBackoff time.Duration // Initial backoff duration
	MaxBackoff     time.Duration // Maximum backoff duration
	BackoffFactor  float64       // Multiplier for exponential backoff
}

// DefaultConfig returns sensible default configuration
func DefaultConfig(basePath string) Config {
	return Config{
		Path:           filepath.Join(basePath, "queue.db"),
		MaxRetries:     10,
		InitialBackoff: 5 * time.Second,
		MaxBackoff:     1 * time.Hour,
		BackoffFactor:  2.0,
	}
}

// Queue manages the offline request queue
type Queue struct {
	db     *sql.DB
	config Config
	mu     sync.RWMutex
}

// New creates a new queue with the given configuration
func New(cfg Config) (*Queue, error) {
	// Ensure directory exists
	dir := filepath.Dir(cfg.Path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create queue directory: %w", err)
	}

	db, err := sql.Open("sqlite3", cfg.Path+"?_journal_mode=WAL")
	if err != nil {
		return nil, fmt.Errorf("failed to open queue database: %w", err)
	}

	q := &Queue{
		db:     db,
		config: cfg,
	}

	if err := q.initialize(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to initialize queue: %w", err)
	}

	return q, nil
}

// initialize creates the database schema
func (q *Queue) initialize() error {
	schema := `
	CREATE TABLE IF NOT EXISTS queued_requests (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		type TEXT NOT NULL,
		payload BLOB NOT NULL,
		retries INTEGER DEFAULT 0,
		max_retries INTEGER NOT NULL,
		next_retry_at DATETIME NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_error TEXT
	);

	CREATE INDEX IF NOT EXISTS idx_next_retry_at ON queued_requests(next_retry_at);
	CREATE INDEX IF NOT EXISTS idx_type ON queued_requests(type);
	`

	_, err := q.db.Exec(schema)
	return err
}

// Enqueue adds a failed request to the queue
func (q *Queue) Enqueue(reqType RequestType, payload interface{}, lastError string) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	nextRetry := time.Now().Add(q.config.InitialBackoff)

	_, err = q.db.Exec(`
		INSERT INTO queued_requests (type, payload, max_retries, next_retry_at, last_error)
		VALUES (?, ?, ?, ?, ?)
	`, reqType, data, q.config.MaxRetries, nextRetry, lastError)

	if err != nil {
		return fmt.Errorf("failed to enqueue request: %w", err)
	}

	log.Debug().
		Str("type", string(reqType)).
		Time("next_retry", nextRetry).
		Msg("Request queued for retry")

	return nil
}

// GetPendingRequests returns requests that are ready for retry
func (q *Queue) GetPendingRequests(limit int) ([]QueuedRequest, error) {
	q.mu.RLock()
	defer q.mu.RUnlock()

	rows, err := q.db.Query(`
		SELECT id, type, payload, retries, max_retries, next_retry_at, created_at, COALESCE(last_error, '')
		FROM queued_requests
		WHERE next_retry_at <= ? AND retries < max_retries
		ORDER BY next_retry_at ASC
		LIMIT ?
	`, time.Now(), limit)

	if err != nil {
		return nil, fmt.Errorf("failed to query pending requests: %w", err)
	}
	defer rows.Close()

	var requests []QueuedRequest
	for rows.Next() {
		var req QueuedRequest
		err := rows.Scan(
			&req.ID,
			&req.Type,
			&req.Payload,
			&req.Retries,
			&req.MaxRetries,
			&req.NextRetryAt,
			&req.CreatedAt,
			&req.LastError,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		requests = append(requests, req)
	}

	return requests, rows.Err()
}

// MarkSuccess removes a successfully processed request from the queue
func (q *Queue) MarkSuccess(id int64) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	_, err := q.db.Exec("DELETE FROM queued_requests WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete request: %w", err)
	}

	log.Debug().Int64("id", id).Msg("Queued request completed successfully")
	return nil
}

// MarkFailed updates a request after a failed retry attempt
func (q *Queue) MarkFailed(id int64, lastError string) error {
	q.mu.Lock()
	defer q.mu.Unlock()

	// Get current retry count
	var retries int
	err := q.db.QueryRow("SELECT retries FROM queued_requests WHERE id = ?", id).Scan(&retries)
	if err != nil {
		return fmt.Errorf("failed to get retry count: %w", err)
	}

	// Calculate next retry with exponential backoff
	newRetries := retries + 1
	backoff := q.calculateBackoff(newRetries)
	nextRetry := time.Now().Add(backoff)

	_, err = q.db.Exec(`
		UPDATE queued_requests
		SET retries = ?, next_retry_at = ?, last_error = ?
		WHERE id = ?
	`, newRetries, nextRetry, lastError, id)

	if err != nil {
		return fmt.Errorf("failed to update request: %w", err)
	}

	log.Debug().
		Int64("id", id).
		Int("retries", newRetries).
		Dur("backoff", backoff).
		Time("next_retry", nextRetry).
		Msg("Request retry scheduled")

	return nil
}

// calculateBackoff computes exponential backoff duration
func (q *Queue) calculateBackoff(retries int) time.Duration {
	backoff := float64(q.config.InitialBackoff)
	for i := 0; i < retries; i++ {
		backoff *= q.config.BackoffFactor
	}

	if backoff > float64(q.config.MaxBackoff) {
		return q.config.MaxBackoff
	}

	return time.Duration(backoff)
}

// PurgeExpired removes requests that have exceeded max retries
func (q *Queue) PurgeExpired() (int64, error) {
	q.mu.Lock()
	defer q.mu.Unlock()

	result, err := q.db.Exec(`
		DELETE FROM queued_requests
		WHERE retries >= max_retries
	`)
	if err != nil {
		return 0, fmt.Errorf("failed to purge expired requests: %w", err)
	}

	count, _ := result.RowsAffected()
	if count > 0 {
		log.Info().Int64("count", count).Msg("Purged expired queued requests")
	}

	return count, nil
}

// Stats returns queue statistics
type Stats struct {
	PendingCount   int64
	ExpiredCount   int64
	OldestPending  *time.Time
	NextRetry      *time.Time
}

func (q *Queue) Stats() (*Stats, error) {
	q.mu.RLock()
	defer q.mu.RUnlock()

	stats := &Stats{}

	// Count pending (retries < max_retries)
	err := q.db.QueryRow(`
		SELECT COUNT(*) FROM queued_requests WHERE retries < max_retries
	`).Scan(&stats.PendingCount)
	if err != nil {
		return nil, err
	}

	// Count expired (retries >= max_retries)
	err = q.db.QueryRow(`
		SELECT COUNT(*) FROM queued_requests WHERE retries >= max_retries
	`).Scan(&stats.ExpiredCount)
	if err != nil {
		return nil, err
	}

	// Oldest pending request
	var oldest sql.NullTime
	q.db.QueryRow(`
		SELECT MIN(created_at) FROM queued_requests WHERE retries < max_retries
	`).Scan(&oldest)
	if oldest.Valid {
		stats.OldestPending = &oldest.Time
	}

	// Next scheduled retry
	var nextRetry sql.NullTime
	q.db.QueryRow(`
		SELECT MIN(next_retry_at) FROM queued_requests
		WHERE retries < max_retries AND next_retry_at > ?
	`, time.Now()).Scan(&nextRetry)
	if nextRetry.Valid {
		stats.NextRetry = &nextRetry.Time
	}

	return stats, nil
}

// Close closes the database connection
func (q *Queue) Close() error {
	return q.db.Close()
}
