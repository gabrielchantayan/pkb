# Feature: Daemon Additional Sources

## Overview

Add additional data sources to the Go daemon: Gmail (multiple accounts), Apple Contacts, Google/Apple Calendar, Phone Calls, and Apple Notes.

## Dependencies

- **Requires**: 11-daemon-core-imessage (daemon infrastructure)
- **Blocks**: None (each source is independent)

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Gmail | OAuth + Gmail API | More reliable than IMAP |
| Multiple Gmail | Array of credential paths | Support multiple accounts |
| Contacts | AddressBook framework via cgo | Direct access |
| Calendar | CalDAV or API | Standard protocol |
| Calls | CallHistoryDB | macOS database |
| Notes | SQLite or AppleScript | Notes database |

## Updated Configuration

```yaml
# config.yaml additions
sources:
  imessage:
    enabled: true
    db_path: ~/Library/Messages/chat.db

  gmail:
    enabled: true
    accounts:
      - name: "personal"
        credentials_path: ./credentials/gmail-personal.json
        token_path: ./tokens/gmail-personal.json
      - name: "work"
        credentials_path: ./credentials/gmail-work.json
        token_path: ./tokens/gmail-work.json
    # Optional: only sync emails after this date
    start_date: "2020-01-01"
    # Labels to sync (empty = all)
    labels: []
    # Labels to exclude
    exclude_labels:
      - "SPAM"
      - "TRASH"

  contacts:
    enabled: true
    import_photos: true
    # Source: 'addressbook' or 'carddav'
    source: addressbook

  calendar:
    enabled: true
    providers:
      - type: google
        credentials_path: ./credentials/gcal.json
        token_path: ./tokens/gcal.json
      - type: apple
        # Uses system calendar access
    # How far back to sync
    lookback_days: 365
    # How far forward to sync
    lookahead_days: 90

  calls:
    enabled: true
    db_path: ~/Library/Application Support/CallHistoryDB/CallHistory.storedata

  notes:
    enabled: true
    # Method: 'sqlite' (direct DB) or 'applescript'
    method: sqlite
    db_path: ~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite
```

## Source Implementations

### Gmail Source (Multiple Accounts)

```go
// internal/sources/gmail/gmail.go
package gmail

import (
    "context"
    "encoding/base64"
    "fmt"
    "strings"
    "time"

    "golang.org/x/oauth2"
    "golang.org/x/oauth2/google"
    "google.golang.org/api/gmail/v1"
    "google.golang.org/api/option"

    "pkb-daemon/internal/api"
    "pkb-daemon/internal/config"
)

type Source struct {
    accounts  []*Account
    startDate time.Time
    blocklist *config.BlocklistConfig
    exclude   map[string]bool
}

type Account struct {
    name    string
    service *gmail.Service
}

func New(cfg config.GmailConfig, blocklist config.BlocklistConfig) (*Source, error) {
    var accounts []*Account

    for _, acctCfg := range cfg.Accounts {
        service, err := createGmailService(acctCfg.CredentialsPath, acctCfg.TokenPath)
        if err != nil {
            return nil, fmt.Errorf("failed to create Gmail service for %s: %w", acctCfg.Name, err)
        }

        accounts = append(accounts, &Account{
            name:    acctCfg.Name,
            service: service,
        })
    }

    exclude := make(map[string]bool)
    for _, label := range cfg.ExcludeLabels {
        exclude[label] = true
    }

    var startDate time.Time
    if cfg.StartDate != "" {
        startDate, _ = time.Parse("2006-01-02", cfg.StartDate)
    }

    return &Source{
        accounts:  accounts,
        startDate: startDate,
        blocklist: &blocklist,
        exclude:   exclude,
    }, nil
}

func (s *Source) Name() string {
    return "gmail"
}

func (s *Source) Sync(ctx context.Context, checkpoint string, limit int) ([]api.Communication, string, error) {
    // Parse checkpoint: "accountName:messageId"
    currentAccount, lastMessageID := parseCheckpoint(checkpoint)

    var comms []api.Communication
    var newCheckpoint string

    // Find which account to resume from
    startIdx := 0
    for i, acct := range s.accounts {
        if acct.name == currentAccount {
            startIdx = i
            break
        }
    }

    remaining := limit

    for i := startIdx; i < len(s.accounts) && remaining > 0; i++ {
        acct := s.accounts[i]

        // Reset lastMessageID for new accounts
        msgID := ""
        if acct.name == currentAccount {
            msgID = lastMessageID
        }

        messages, nextMsgID, err := s.syncAccount(ctx, acct, msgID, remaining)
        if err != nil {
            return comms, newCheckpoint, err
        }

        comms = append(comms, messages...)
        remaining -= len(messages)
        newCheckpoint = fmt.Sprintf("%s:%s", acct.name, nextMsgID)

        if len(messages) > 0 && len(messages) == remaining+len(messages) {
            // Hit limit within this account
            break
        }
    }

    return comms, newCheckpoint, nil
}

func (s *Source) syncAccount(ctx context.Context, acct *Account, afterMessageID string, limit int) ([]api.Communication, string, error) {
    query := ""
    if !s.startDate.IsZero() {
        query = fmt.Sprintf("after:%s", s.startDate.Format("2006/01/02"))
    }

    req := acct.service.Users.Messages.List("me").Q(query).MaxResults(int64(limit))
    if afterMessageID != "" {
        // Gmail doesn't have native "after ID" - we use page tokens stored separately
        // For simplicity, using timestamp-based querying
    }

    resp, err := req.Context(ctx).Do()
    if err != nil {
        return nil, afterMessageID, err
    }

    var comms []api.Communication
    var lastID string

    for _, msg := range resp.Messages {
        full, err := acct.service.Users.Messages.Get("me", msg.Id).Format("full").Context(ctx).Do()
        if err != nil {
            continue
        }

        // Check excluded labels
        skip := false
        for _, labelID := range full.LabelIds {
            if s.exclude[labelID] {
                skip = true
                break
            }
        }
        if skip {
            lastID = msg.Id
            continue
        }

        comm, err := s.parseMessage(full, acct.name)
        if err != nil {
            continue
        }

        if s.isBlocked(comm.ContactIdentifier) {
            lastID = msg.Id
            continue
        }

        comms = append(comms, *comm)
        lastID = msg.Id
    }

    return comms, lastID, nil
}

func (s *Source) parseMessage(msg *gmail.Message, accountName string) (*api.Communication, error) {
    headers := make(map[string]string)
    for _, h := range msg.Payload.Headers {
        headers[strings.ToLower(h.Name)] = h.Value
    }

    // Determine direction and contact
    from := headers["from"]
    to := headers["to"]

    // Parse email address from "Name <email>" format
    fromEmail := parseEmailAddress(from)
    toEmail := parseEmailAddress(to)

    // Get user's email to determine direction
    profile, _ := msg.service.Users.GetProfile("me").Do()
    userEmail := profile.EmailAddress

    var direction string
    var contactEmail string

    if strings.EqualFold(fromEmail, userEmail) {
        direction = "outbound"
        contactEmail = toEmail
    } else {
        direction = "inbound"
        contactEmail = fromEmail
    }

    // Parse body
    body := extractBody(msg.Payload)

    // Parse timestamp
    timestamp := time.Unix(msg.InternalDate/1000, 0)

    return &api.Communication{
        Source:   "gmail",
        SourceID: fmt.Sprintf("%s:%s", accountName, msg.Id),
        ContactIdentifier: api.ContactIdentifier{
            Type:  "email",
            Value: strings.ToLower(contactEmail),
        },
        Direction: direction,
        Subject:   headers["subject"],
        Content:   body,
        Timestamp: timestamp,
        ThreadID:  msg.ThreadId,
        Metadata: map[string]interface{}{
            "account":   accountName,
            "labels":    msg.LabelIds,
            "snippet":   msg.Snippet,
        },
    }, nil
}

func extractBody(payload *gmail.MessagePart) string {
    if payload.Body != nil && payload.Body.Data != "" {
        data, _ := base64.URLEncoding.DecodeString(payload.Body.Data)
        return string(data)
    }

    for _, part := range payload.Parts {
        if part.MimeType == "text/plain" {
            data, _ := base64.URLEncoding.DecodeString(part.Body.Data)
            return string(data)
        }
    }

    // Fallback to HTML
    for _, part := range payload.Parts {
        if part.MimeType == "text/html" {
            data, _ := base64.URLEncoding.DecodeString(part.Body.Data)
            return stripHTML(string(data))
        }
    }

    return ""
}
```

### Apple Contacts Source

```go
// internal/sources/contacts/contacts.go
package contacts

import (
    "context"
    "database/sql"
    "os"
    "path/filepath"
    "strings"

    _ "github.com/mattn/go-sqlite3"

    "pkb-daemon/internal/api"
    "pkb-daemon/internal/config"
)

type Source struct {
    dbPath       string
    importPhotos bool
}

func New(cfg config.ContactsConfig) (*Source, error) {
    // Default AddressBook database path
    home, _ := os.UserHomeDir()
    dbPath := filepath.Join(home, "Library/Application Support/AddressBook/AddressBook-v22.abcddb")

    return &Source{
        dbPath:       dbPath,
        importPhotos: cfg.ImportPhotos,
    }, nil
}

func (s *Source) Name() string {
    return "contacts"
}

// Contacts are synced differently - they create/update contacts, not communications
func (s *Source) SyncContacts(ctx context.Context) ([]ContactImport, error) {
    db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
    if err != nil {
        return nil, err
    }
    defer db.Close()

    // Query contacts with emails and phones
    query := `
        SELECT
            r.Z_PK,
            r.ZFIRSTNAME,
            r.ZLASTNAME,
            r.ZORGANIZATION,
            r.ZJOBTITLE,
            r.ZBIRTHDAY,
            r.ZNOTE
        FROM ZABCDRECORD r
        WHERE r.Z_ENT = 9
    `

    rows, err := db.QueryContext(ctx, query)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var imports []ContactImport

    for rows.Next() {
        var pk int64
        var firstName, lastName, org, jobTitle, note sql.NullString
        var birthday sql.NullFloat64

        err := rows.Scan(&pk, &firstName, &lastName, &org, &jobTitle, &birthday, &note)
        if err != nil {
            continue
        }

        displayName := strings.TrimSpace(firstName.String + " " + lastName.String)
        if displayName == "" {
            displayName = org.String
        }
        if displayName == "" {
            continue
        }

        contact := ContactImport{
            SourceID:    fmt.Sprintf("ab:%d", pk),
            DisplayName: displayName,
        }

        // Get emails
        emails, _ := s.getEmails(db, pk)
        contact.Emails = emails

        // Get phones
        phones, _ := s.getPhones(db, pk)
        contact.Phones = phones

        // Add facts
        if org.Valid && org.String != "" {
            contact.Facts = append(contact.Facts, Fact{Type: "company", Value: org.String})
        }
        if jobTitle.Valid && jobTitle.String != "" {
            contact.Facts = append(contact.Facts, Fact{Type: "job_title", Value: jobTitle.String})
        }
        if birthday.Valid {
            // Convert Core Data timestamp
            bday := coreDataTimestampToTime(birthday.Float64)
            contact.Facts = append(contact.Facts, Fact{
                Type:  "birthday",
                Value: bday.Format("2006-01-02"),
            })
        }
        if note.Valid && note.String != "" {
            contact.Note = note.String
        }

        // Get photo if enabled
        if s.importPhotos {
            photo, _ := s.getPhoto(db, pk)
            contact.PhotoData = photo
        }

        imports = append(imports, contact)
    }

    return imports, nil
}

func (s *Source) getEmails(db *sql.DB, recordPK int64) ([]string, error) {
    rows, err := db.Query(`
        SELECT ZADDRESS FROM ZABCDEMAILADDRESS WHERE ZOWNER = ?
    `, recordPK)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var emails []string
    for rows.Next() {
        var email string
        rows.Scan(&email)
        if email != "" {
            emails = append(emails, strings.ToLower(email))
        }
    }
    return emails, nil
}

func (s *Source) getPhones(db *sql.DB, recordPK int64) ([]string, error) {
    rows, err := db.Query(`
        SELECT ZFULLNUMBER FROM ZABCDPHONENUMBER WHERE ZOWNER = ?
    `, recordPK)
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var phones []string
    for rows.Next() {
        var phone string
        rows.Scan(&phone)
        if phone != "" {
            phones = append(phones, normalizePhone(phone))
        }
    }
    return phones, nil
}

type ContactImport struct {
    SourceID    string
    DisplayName string
    Emails      []string
    Phones      []string
    Facts       []Fact
    Note        string
    PhotoData   []byte
}

type Fact struct {
    Type  string
    Value string
}
```

### Calendar Source

```go
// internal/sources/calendar/calendar.go
package calendar

import (
    "context"
    "time"

    "google.golang.org/api/calendar/v3"

    "pkb-daemon/internal/api"
    "pkb-daemon/internal/config"
)

type Source struct {
    providers    []CalendarProvider
    lookbackDays int
    lookaheadDays int
}

type CalendarProvider interface {
    Name() string
    GetEvents(ctx context.Context, start, end time.Time) ([]CalendarEvent, error)
}

type GoogleCalendarProvider struct {
    service *calendar.Service
}

func (p *GoogleCalendarProvider) GetEvents(ctx context.Context, start, end time.Time) ([]CalendarEvent, error) {
    events, err := p.service.Events.List("primary").
        TimeMin(start.Format(time.RFC3339)).
        TimeMax(end.Format(time.RFC3339)).
        SingleEvents(true).
        OrderBy("startTime").
        Context(ctx).
        Do()

    if err != nil {
        return nil, err
    }

    var result []CalendarEvent
    for _, e := range events.Items {
        event := CalendarEvent{
            SourceID:    e.Id,
            Title:       e.Summary,
            Description: e.Description,
            Location:    e.Location,
            Attendees:   []string{},
        }

        // Parse times
        if e.Start.DateTime != "" {
            event.StartTime, _ = time.Parse(time.RFC3339, e.Start.DateTime)
        } else {
            event.StartTime, _ = time.Parse("2006-01-02", e.Start.Date)
        }

        if e.End.DateTime != "" {
            event.EndTime, _ = time.Parse(time.RFC3339, e.End.DateTime)
        } else {
            event.EndTime, _ = time.Parse("2006-01-02", e.End.Date)
        }

        // Extract attendee emails
        for _, att := range e.Attendees {
            if att.Email != "" {
                event.Attendees = append(event.Attendees, att.Email)
            }
        }

        result = append(result, event)
    }

    return result, nil
}

type CalendarEvent struct {
    SourceID    string
    Title       string
    Description string
    Location    string
    StartTime   time.Time
    EndTime     time.Time
    Attendees   []string
}

func (s *Source) Name() string {
    return "calendar"
}

func (s *Source) Sync(ctx context.Context, checkpoint string) ([]CalendarEvent, string, error) {
    start := time.Now().AddDate(0, 0, -s.lookbackDays)
    end := time.Now().AddDate(0, 0, s.lookaheadDays)

    var allEvents []CalendarEvent

    for _, provider := range s.providers {
        events, err := provider.GetEvents(ctx, start, end)
        if err != nil {
            continue
        }
        allEvents = append(allEvents, events...)
    }

    return allEvents, time.Now().Format(time.RFC3339), nil
}
```

### Phone Calls Source

```go
// internal/sources/calls/calls.go
package calls

import (
    "context"
    "database/sql"
    "fmt"
    "os"
    "path/filepath"
    "time"

    _ "github.com/mattn/go-sqlite3"

    "pkb-daemon/internal/api"
    "pkb-daemon/internal/config"
)

type Source struct {
    dbPath    string
    blocklist *config.BlocklistConfig
}

func New(cfg config.CallsConfig, blocklist config.BlocklistConfig) (*Source, error) {
    dbPath := cfg.DBPath
    if dbPath == "" {
        home, _ := os.UserHomeDir()
        dbPath = filepath.Join(home, "Library/Application Support/CallHistoryDB/CallHistory.storedata")
    }

    return &Source{
        dbPath:    expandPath(dbPath),
        blocklist: &blocklist,
    }, nil
}

func (s *Source) Name() string {
    return "calls"
}

func (s *Source) Sync(ctx context.Context, checkpoint string, limit int) ([]api.Communication, string, error) {
    db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
    if err != nil {
        return nil, checkpoint, err
    }
    defer db.Close()

    var lastRowID int64 = 0
    if checkpoint != "" {
        fmt.Sscanf(checkpoint, "%d", &lastRowID)
    }

    query := `
        SELECT
            Z_PK,
            ZADDRESS,
            ZDURATION,
            ZDATE,
            ZORIGINATED,
            ZANSWERED
        FROM ZCALLRECORD
        WHERE Z_PK > ?
        ORDER BY Z_PK ASC
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
        var pk int64
        var address sql.NullString
        var duration sql.NullFloat64
        var dateVal sql.NullFloat64
        var originated, answered sql.NullInt64

        err := rows.Scan(&pk, &address, &duration, &dateVal, &originated, &answered)
        if err != nil {
            continue
        }

        if !address.Valid || address.String == "" {
            newCheckpoint = fmt.Sprintf("%d", pk)
            continue
        }

        phone := normalizePhone(address.String)
        if s.isBlocked(phone) {
            newCheckpoint = fmt.Sprintf("%d", pk)
            continue
        }

        timestamp := coreDataTimestampToTime(dateVal.Float64)

        direction := "inbound"
        if originated.Int64 == 1 {
            direction = "outbound"
        }

        status := "missed"
        if answered.Int64 == 1 {
            status = "answered"
        }

        comm := api.Communication{
            Source:   "calls",
            SourceID: fmt.Sprintf("call:%d", pk),
            ContactIdentifier: api.ContactIdentifier{
                Type:  "phone",
                Value: phone,
            },
            Direction: direction,
            Content:   fmt.Sprintf("%s call, %d seconds", status, int(duration.Float64)),
            Timestamp: timestamp,
            Metadata: map[string]interface{}{
                "duration_seconds": duration.Float64,
                "status":           status,
            },
        }

        comms = append(comms, comm)
        newCheckpoint = fmt.Sprintf("%d", pk)
    }

    return comms, newCheckpoint, nil
}

func (s *Source) isBlocked(phone string) bool {
    for _, blocked := range s.blocklist.Phones {
        if phone == blocked || phone == normalizePhone(blocked) {
            return true
        }
    }
    return false
}
```

### Apple Notes Source

```go
// internal/sources/notes/notes.go
package notes

import (
    "context"
    "database/sql"
    "fmt"
    "os"
    "path/filepath"

    _ "github.com/mattn/go-sqlite3"

    "pkb-daemon/internal/api"
    "pkb-daemon/internal/config"
)

type Source struct {
    dbPath string
}

func New(cfg config.NotesConfig) (*Source, error) {
    dbPath := cfg.DBPath
    if dbPath == "" {
        home, _ := os.UserHomeDir()
        dbPath = filepath.Join(home, "Library/Group Containers/group.com.apple.notes/NoteStore.sqlite")
    }

    return &Source{
        dbPath: expandPath(dbPath),
    }, nil
}

func (s *Source) Name() string {
    return "notes"
}

// Notes are imported as notes, not communications
// They'll need LLM processing to extract mentioned contacts
func (s *Source) Sync(ctx context.Context, checkpoint string, limit int) ([]NoteImport, string, error) {
    db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
    if err != nil {
        return nil, checkpoint, err
    }
    defer db.Close()

    var lastRowID int64 = 0
    if checkpoint != "" {
        fmt.Sscanf(checkpoint, "%d", &lastRowID)
    }

    query := `
        SELECT
            n.Z_PK,
            n.ZTITLE,
            nb.ZDATA,
            n.ZMODIFICATIONDATE
        FROM ZICCLOUDSYNCINGOBJECT n
        LEFT JOIN ZICNOTEDATA nb ON nb.ZNOTE = n.Z_PK
        WHERE n.ZTYPEUTI = 'com.apple.notes.note'
          AND n.Z_PK > ?
          AND n.ZMARKEDFORDELETION != 1
        ORDER BY n.Z_PK ASC
        LIMIT ?
    `

    rows, err := db.QueryContext(ctx, query, lastRowID, limit)
    if err != nil {
        return nil, checkpoint, err
    }
    defer rows.Close()

    var notes []NoteImport
    var newCheckpoint string

    for rows.Next() {
        var pk int64
        var title sql.NullString
        var data []byte
        var modDate sql.NullFloat64

        err := rows.Scan(&pk, &title, &data, &modDate)
        if err != nil {
            continue
        }

        content := extractNoteContent(data)
        if content == "" {
            newCheckpoint = fmt.Sprintf("%d", pk)
            continue
        }

        note := NoteImport{
            SourceID:  fmt.Sprintf("note:%d", pk),
            Title:     title.String,
            Content:   content,
            UpdatedAt: coreDataTimestampToTime(modDate.Float64),
        }

        notes = append(notes, note)
        newCheckpoint = fmt.Sprintf("%d", pk)
    }

    return notes, newCheckpoint, nil
}

type NoteImport struct {
    SourceID  string
    Title     string
    Content   string
    UpdatedAt time.Time
}

func extractNoteContent(data []byte) string {
    // Apple Notes stores content as gzipped protobuf
    // This is a simplified extraction - may need proper protobuf parsing
    // For now, extract plain text portions
    // ... implementation details
    return string(data) // Simplified
}
```

## New API Endpoint for Contacts Import

```
POST /api/sync/contacts
Headers: X-API-Key: <daemon-key>
Body:
{
  contacts: {
    source_id: string,
    display_name: string,
    emails: string[],
    phones: string[],
    facts: { type: string, value: string }[],
    note?: string,
    photo_data?: string  // base64
  }[]
}

Response:
{
  created: number,
  updated: number,
  merged: number,
  errors: { index: number, error: string }[]
}
```

## Implementation Steps

1. Update config structs for new sources
2. Implement Gmail source with multiple accounts
3. Add OAuth flow helper for Gmail setup
4. Implement Apple Contacts source
5. Implement Google Calendar source
6. Implement Apple Calendar source (via EventKit)
7. Implement Phone Calls source
8. Implement Apple Notes source
9. Add contacts import endpoint to backend
10. Update sync manager to handle different source types
11. Test each source independently
12. Test full sync with all sources enabled

## Acceptance Criteria

- [ ] Gmail syncs from multiple configured accounts
- [ ] Gmail checkpoint tracks per-account progress
- [ ] Gmail respects label exclusions
- [ ] Contacts imported with emails, phones, and facts
- [ ] Contact photos imported when enabled
- [ ] Calendar events synced with attendees
- [ ] Phone calls synced with duration and status
- [ ] Apple Notes synced (content extraction)
- [ ] Each source can be enabled/disabled independently
- [ ] Blocklist applies across all sources
- [ ] All sources use incremental sync with checkpoints

## Files to Create

| Path | Purpose |
|------|---------|
| `daemon/internal/sources/gmail/gmail.go` | Gmail source |
| `daemon/internal/sources/gmail/oauth.go` | OAuth helper |
| `daemon/internal/sources/contacts/contacts.go` | Apple Contacts |
| `daemon/internal/sources/calendar/calendar.go` | Calendar source |
| `daemon/internal/sources/calendar/google.go` | Google Calendar |
| `daemon/internal/sources/calendar/apple.go` | Apple Calendar |
| `daemon/internal/sources/calls/calls.go` | Phone calls |
| `daemon/internal/sources/notes/notes.go` | Apple Notes |
| `packages/backend/src/routes/sync.ts` | Contacts import endpoint |

## Notes for Implementation

- Gmail OAuth requires user interaction for initial auth
- Consider adding `oauth-setup` command to daemon CLI
- Apple Notes content is protobuf - may need external library
- Calendar attendees should be matched to existing contacts
- Phone calls have limited info - mainly for timeline
- Some sources may need Full Disk Access permission
- Consider adding source-specific rate limiting
- Notes will need LLM processing to link to contacts (future)
