# Feature: Daemon Core + iMessage

## Overview

Go daemon for macOS that syncs local data sources to the backend. This plan covers the core daemon infrastructure and iMessage sync as the first data source.

## Dependencies

- **Requires**: 01-project-foundation (backend API), 02-authentication (API key), 04-communications (batch upsert)
- **Blocks**: 12-daemon-additional-sources

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | Go | Specified in SPEC, good for daemon |
| Config | YAML | Human-readable, specified in SPEC |
| Logging | zerolog | Structured JSON logging |
| iMessage access | SQLite direct read | chat.db on macOS |
| Sync strategy | Incremental with checkpoint | Efficient, resumable |

## Repository Structure

```
daemon/
├── cmd/
│   └── pkb-daemon/
│       └── main.go           # Entry point
├── internal/
│   ├── config/
│   │   └── config.go         # YAML config loading
│   ├── api/
│   │   └── client.go         # Backend API client
│   ├── sync/
│   │   ├── manager.go        # Sync orchestration
│   │   └── state.go          # Checkpoint management
│   ├── sources/
│   │   ├── source.go         # Source interface
│   │   └── imessage/
│   │       ├── imessage.go   # iMessage source
│   │       └── parser.go     # Message parsing
│   └── queue/
│       └── queue.go          # Offline queue
├── config.example.yaml
├── go.mod
├── go.sum
└── Makefile
```

## Configuration

```yaml
# config.yaml
backend:
  url: https://your-server.example.com
  api_key: your-api-key-here

sources:
  imessage:
    enabled: true
    db_path: ~/Library/Messages/chat.db
    # Optional: only sync messages after this date
    start_date: "2020-01-01"

sync:
  interval_seconds: 60
  batch_size: 100
  # Maximum messages to process per sync cycle
  max_per_cycle: 1000

blocklist:
  phones:
    - "+15551234567"
  emails:
    - "spam@example.com"
  # Partial matches on contact names
  names:
    - "Do Not Contact"

logging:
  level: info  # debug, info, warn, error
  format: json # json or console
  path: ""     # empty for stdout, or path to file

state:
  # Where to store sync checkpoints
  path: ~/.pkb-daemon/state.json
```

## Implementation

### Main Entry Point

```go
// cmd/pkb-daemon/main.go
package main

import (
    "context"
    "flag"
    "os"
    "os/signal"
    "syscall"

    "github.com/rs/zerolog"
    "github.com/rs/zerolog/log"

    "pkb-daemon/internal/config"
    "pkb-daemon/internal/api"
    "pkb-daemon/internal/sync"
    "pkb-daemon/internal/sources/imessage"
)

func main() {
    configPath := flag.String("config", "config.yaml", "Path to config file")
    flag.Parse()

    // Load config
    cfg, err := config.Load(*configPath)
    if err != nil {
        log.Fatal().Err(err).Msg("Failed to load config")
    }

    // Setup logging
    setupLogging(cfg.Logging)

    // Create API client
    client := api.NewClient(cfg.Backend.URL, cfg.Backend.APIKey)

    // Verify connection
    if err := client.HealthCheck(); err != nil {
        log.Fatal().Err(err).Msg("Backend health check failed")
    }
    log.Info().Msg("Connected to backend")

    // Create sync manager
    manager := sync.NewManager(client, cfg)

    // Register sources
    if cfg.Sources.IMessage.Enabled {
        src, err := imessage.New(cfg.Sources.IMessage, cfg.Blocklist)
        if err != nil {
            log.Fatal().Err(err).Msg("Failed to initialize iMessage source")
        }
        manager.RegisterSource(src)
    }

    // Handle shutdown gracefully
    ctx, cancel := context.WithCancel(context.Background())
    sigCh := make(chan os.Signal, 1)
    signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

    go func() {
        <-sigCh
        log.Info().Msg("Shutting down...")
        cancel()
    }()

    // Start sync loop
    if err := manager.Run(ctx); err != nil {
        log.Fatal().Err(err).Msg("Sync manager failed")
    }
}
```

### Config Loading

```go
// internal/config/config.go
package config

import (
    "os"
    "path/filepath"

    "gopkg.in/yaml.v3"
)

type Config struct {
    Backend   BackendConfig   `yaml:"backend"`
    Sources   SourcesConfig   `yaml:"sources"`
    Sync      SyncConfig      `yaml:"sync"`
    Blocklist BlocklistConfig `yaml:"blocklist"`
    Logging   LoggingConfig   `yaml:"logging"`
    State     StateConfig     `yaml:"state"`
}

type BackendConfig struct {
    URL    string `yaml:"url"`
    APIKey string `yaml:"api_key"`
}

type SourcesConfig struct {
    IMessage IMessageConfig `yaml:"imessage"`
    // Future sources added here
}

type IMessageConfig struct {
    Enabled   bool   `yaml:"enabled"`
    DBPath    string `yaml:"db_path"`
    StartDate string `yaml:"start_date"`
}

type SyncConfig struct {
    IntervalSeconds int `yaml:"interval_seconds"`
    BatchSize       int `yaml:"batch_size"`
    MaxPerCycle     int `yaml:"max_per_cycle"`
}

type BlocklistConfig struct {
    Phones []string `yaml:"phones"`
    Emails []string `yaml:"emails"`
    Names  []string `yaml:"names"`
}

type LoggingConfig struct {
    Level  string `yaml:"level"`
    Format string `yaml:"format"`
    Path   string `yaml:"path"`
}

type StateConfig struct {
    Path string `yaml:"path"`
}

func Load(path string) (*Config, error) {
    // Expand ~ in paths
    if path[0] == '~' {
        home, _ := os.UserHomeDir()
        path = filepath.Join(home, path[1:])
    }

    data, err := os.ReadFile(path)
    if err != nil {
        return nil, err
    }

    var cfg Config
    if err := yaml.Unmarshal(data, &cfg); err != nil {
        return nil, err
    }

    // Set defaults
    if cfg.Sync.IntervalSeconds == 0 {
        cfg.Sync.IntervalSeconds = 60
    }
    if cfg.Sync.BatchSize == 0 {
        cfg.Sync.BatchSize = 100
    }
    if cfg.Sync.MaxPerCycle == 0 {
        cfg.Sync.MaxPerCycle = 1000
    }
    if cfg.State.Path == "" {
        home, _ := os.UserHomeDir()
        cfg.State.Path = filepath.Join(home, ".pkb-daemon", "state.json")
    }

    return &cfg, nil
}
```

### API Client

```go
// internal/api/client.go
package api

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "time"
)

type Client struct {
    baseURL    string
    apiKey     string
    httpClient *http.Client
}

func NewClient(baseURL, apiKey string) *Client {
    return &Client{
        baseURL: baseURL,
        apiKey:  apiKey,
        httpClient: &http.Client{
            Timeout: 30 * time.Second,
        },
    }
}

func (c *Client) HealthCheck() error {
    resp, err := c.get("/api/health")
    if err != nil {
        return err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        return fmt.Errorf("health check returned %d", resp.StatusCode)
    }
    return nil
}

type BatchUpsertRequest struct {
    Communications []Communication `json:"communications"`
}

type Communication struct {
    Source            string                 `json:"source"`
    SourceID          string                 `json:"source_id"`
    ContactIdentifier ContactIdentifier      `json:"contact_identifier"`
    Direction         string                 `json:"direction"`
    Subject           string                 `json:"subject,omitempty"`
    Content           string                 `json:"content"`
    Timestamp         time.Time              `json:"timestamp"`
    Metadata          map[string]interface{} `json:"metadata,omitempty"`
    ThreadID          string                 `json:"thread_id,omitempty"`
    Attachments       []Attachment           `json:"attachments,omitempty"`
}

type ContactIdentifier struct {
    Type  string `json:"type"`
    Value string `json:"value"`
}

type Attachment struct {
    Filename  string `json:"filename"`
    MimeType  string `json:"mime_type"`
    SizeBytes int64  `json:"size_bytes"`
    Data      string `json:"data"` // base64
}

type BatchUpsertResponse struct {
    Inserted int           `json:"inserted"`
    Updated  int           `json:"updated"`
    Errors   []BatchError  `json:"errors"`
}

type BatchError struct {
    Index int    `json:"index"`
    Error string `json:"error"`
}

func (c *Client) BatchUpsert(comms []Communication) (*BatchUpsertResponse, error) {
    body, _ := json.Marshal(BatchUpsertRequest{Communications: comms})

    resp, err := c.post("/api/communications/batch", body)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    if resp.StatusCode != 200 {
        bodyBytes, _ := io.ReadAll(resp.Body)
        return nil, fmt.Errorf("batch upsert failed: %d - %s", resp.StatusCode, string(bodyBytes))
    }

    var result BatchUpsertResponse
    if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
        return nil, err
    }

    return &result, nil
}

func (c *Client) get(path string) (*http.Response, error) {
    req, _ := http.NewRequest("GET", c.baseURL+path, nil)
    req.Header.Set("X-API-Key", c.apiKey)
    return c.httpClient.Do(req)
}

func (c *Client) post(path string, body []byte) (*http.Response, error) {
    req, _ := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(body))
    req.Header.Set("X-API-Key", c.apiKey)
    req.Header.Set("Content-Type", "application/json")
    return c.httpClient.Do(req)
}
```

### Sync Manager

```go
// internal/sync/manager.go
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
```

### iMessage Source

```go
// internal/sources/imessage/imessage.go
package imessage

import (
    "context"
    "database/sql"
    "encoding/base64"
    "fmt"
    "os"
    "path/filepath"
    "strings"
    "time"

    _ "github.com/mattn/go-sqlite3"

    "pkb-daemon/internal/api"
    "pkb-daemon/internal/config"
)

type Source struct {
    dbPath    string
    startDate time.Time
    blocklist *config.BlocklistConfig
}

func New(cfg config.IMessageConfig, blocklist config.BlocklistConfig) (*Source, error) {
    // Expand ~ in path
    dbPath := cfg.DBPath
    if strings.HasPrefix(dbPath, "~") {
        home, _ := os.UserHomeDir()
        dbPath = filepath.Join(home, dbPath[1:])
    }

    // Verify file exists
    if _, err := os.Stat(dbPath); os.IsNotExist(err) {
        return nil, fmt.Errorf("iMessage database not found at %s", dbPath)
    }

    var startDate time.Time
    if cfg.StartDate != "" {
        var err error
        startDate, err = time.Parse("2006-01-02", cfg.StartDate)
        if err != nil {
            return nil, fmt.Errorf("invalid start_date format: %w", err)
        }
    }

    return &Source{
        dbPath:    dbPath,
        startDate: startDate,
        blocklist: &blocklist,
    }, nil
}

func (s *Source) Name() string {
    return "imessage"
}

func (s *Source) Sync(ctx context.Context, checkpoint string, limit int) ([]api.Communication, string, error) {
    // Open database (read-only)
    db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
    if err != nil {
        return nil, checkpoint, err
    }
    defer db.Close()

    // Parse checkpoint (message ROWID)
    var lastRowID int64 = 0
    if checkpoint != "" {
        fmt.Sscanf(checkpoint, "%d", &lastRowID)
    }

    // Query messages
    query := `
        SELECT
            m.ROWID,
            m.guid,
            m.text,
            m.date,
            m.is_from_me,
            m.cache_has_attachments,
            h.id as handle_id,
            h.service,
            c.chat_identifier
        FROM message m
        LEFT JOIN handle h ON m.handle_id = h.ROWID
        LEFT JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
        LEFT JOIN chat c ON cmj.chat_id = c.ROWID
        WHERE m.ROWID > ?
          AND m.text IS NOT NULL
          AND m.text != ''
        ORDER BY m.ROWID ASC
        LIMIT ?
    `

    rows, err := db.QueryContext(ctx, query, lastRowID, limit)
    if err != nil {
        return nil, checkpoint, err
    }
    defer rows.Close()

    var comms []api.Communication
    var newCheckpoint string

    for rows.Next() {
        var rowID int64
        var guid, text string
        var dateInt int64
        var isFromMe int
        var hasAttachments int
        var handleID, service, chatID sql.NullString

        err := rows.Scan(&rowID, &guid, &text, &dateInt, &isFromMe, &hasAttachments, &handleID, &service, &chatID)
        if err != nil {
            continue
        }

        // Convert Apple timestamp (nanoseconds since 2001-01-01) to time.Time
        timestamp := appleTimestampToTime(dateInt)

        // Skip if before start date
        if !s.startDate.IsZero() && timestamp.Before(s.startDate) {
            newCheckpoint = fmt.Sprintf("%d", rowID)
            continue
        }

        // Determine contact identifier
        identifier := s.parseIdentifier(handleID.String)
        if identifier == nil {
            newCheckpoint = fmt.Sprintf("%d", rowID)
            continue
        }

        // Check blocklist
        if s.isBlocked(identifier) {
            newCheckpoint = fmt.Sprintf("%d", rowID)
            continue
        }

        direction := "inbound"
        if isFromMe == 1 {
            direction = "outbound"
        }

        comm := api.Communication{
            Source:            "imessage",
            SourceID:          guid,
            ContactIdentifier: *identifier,
            Direction:         direction,
            Content:           text,
            Timestamp:         timestamp,
            ThreadID:          chatID.String,
            Metadata: map[string]interface{}{
                "service": service.String,
            },
        }

        // Get attachments if present
        if hasAttachments == 1 {
            attachments, _ := s.getAttachments(db, rowID)
            comm.Attachments = attachments
        }

        comms = append(comms, comm)
        newCheckpoint = fmt.Sprintf("%d", rowID)
    }

    return comms, newCheckpoint, nil
}

func (s *Source) parseIdentifier(handleID string) *api.ContactIdentifier {
    if handleID == "" {
        return nil
    }

    // Phone number
    if strings.HasPrefix(handleID, "+") || strings.HasPrefix(handleID, "1") || len(handleID) == 10 {
        normalized := "+" + strings.TrimPrefix(handleID, "+")
        return &api.ContactIdentifier{Type: "phone", Value: normalized}
    }

    // Email
    if strings.Contains(handleID, "@") {
        return &api.ContactIdentifier{Type: "email", Value: strings.ToLower(handleID)}
    }

    return nil
}

func (s *Source) isBlocked(id *api.ContactIdentifier) bool {
    if id.Type == "phone" {
        for _, blocked := range s.blocklist.Phones {
            if strings.Contains(id.Value, strings.TrimPrefix(blocked, "+")) {
                return true
            }
        }
    }
    if id.Type == "email" {
        for _, blocked := range s.blocklist.Emails {
            if strings.EqualFold(id.Value, blocked) {
                return true
            }
        }
    }
    return false
}

func (s *Source) getAttachments(db *sql.DB, messageRowID int64) ([]api.Attachment, error) {
    query := `
        SELECT a.filename, a.mime_type, a.total_bytes
        FROM attachment a
        JOIN message_attachment_join maj ON a.ROWID = maj.attachment_id
        WHERE maj.message_id = ?
    `

    rows, err := db.Query(query, messageRowID)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var attachments []api.Attachment

    for rows.Next() {
        var filename, mimeType sql.NullString
        var totalBytes sql.NullInt64

        err := rows.Scan(&filename, &mimeType, &totalBytes)
        if err != nil {
            continue
        }

        if !filename.Valid || filename.String == "" {
            continue
        }

        // Read file and encode as base64
        filePath := strings.Replace(filename.String, "~", os.Getenv("HOME"), 1)
        data, err := os.ReadFile(filePath)
        if err != nil {
            continue // Skip if file not readable
        }

        attachments = append(attachments, api.Attachment{
            Filename:  filepath.Base(filePath),
            MimeType:  mimeType.String,
            SizeBytes: totalBytes.Int64,
            Data:      base64.StdEncoding.EncodeToString(data),
        })
    }

    return attachments, nil
}

func appleTimestampToTime(appleTime int64) time.Time {
    // Apple timestamps are nanoseconds since 2001-01-01
    appleEpoch := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
    return appleEpoch.Add(time.Duration(appleTime) * time.Nanosecond)
}
```

## Implementation Steps

1. Initialize Go module: `go mod init pkb-daemon`
2. Create directory structure
3. Implement config loading with YAML
4. Implement API client with batch upsert
5. Implement sync manager with checkpoint state
6. Implement iMessage source with SQLite reading
7. Implement blocklist filtering
8. Implement attachment extraction
9. Add graceful shutdown handling
10. Create Makefile with build targets
11. Test with sample iMessage database
12. Test full sync cycle with backend

## Acceptance Criteria

- [ ] Daemon reads config from YAML file
- [ ] Daemon connects to backend and verifies health
- [ ] iMessage source reads from chat.db
- [ ] Messages synced incrementally using ROWID checkpoint
- [ ] Blocklist filters excluded contacts
- [ ] Attachments extracted and sent as base64
- [ ] Sync runs on configurable interval
- [ ] Graceful shutdown saves checkpoint state
- [ ] Daemon logs in structured JSON format
- [ ] `make build` produces working binary

## Files to Create

| Path | Purpose |
|------|---------|
| `daemon/go.mod` | Go module definition |
| `daemon/cmd/pkb-daemon/main.go` | Entry point |
| `daemon/internal/config/config.go` | Config loading |
| `daemon/internal/api/client.go` | Backend API client |
| `daemon/internal/sync/manager.go` | Sync orchestration |
| `daemon/internal/sync/state.go` | Checkpoint persistence |
| `daemon/internal/sources/source.go` | Source interface |
| `daemon/internal/sources/imessage/imessage.go` | iMessage source |
| `daemon/config.example.yaml` | Example config |
| `daemon/Makefile` | Build targets |

## Notes for Implementation

- Requires Full Disk Access permission on macOS for chat.db
- Apple timestamps are nanoseconds since 2001-01-01, not Unix epoch
- chat.db is SQLite, use read-only mode to avoid locking
- Handle IDs can be phone numbers or email addresses
- Group chats have multiple participants - current impl handles 1:1 only
- Consider adding group chat support as enhancement
- Attachment files may be in various locations, some may not be readable
- State file should be in ~/.pkb-daemon/ by default
