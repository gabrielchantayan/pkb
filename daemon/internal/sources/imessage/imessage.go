package imessage

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
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
	dbPath := cfg.DBPath

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
		lastRowID, _ = strconv.ParseInt(checkpoint, 10, 64)
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
	newCheckpoint := checkpoint

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
			newCheckpoint = strconv.FormatInt(rowID, 10)
			continue
		}

		// Determine contact identifier
		identifier := s.parseIdentifier(handleID.String)
		if identifier == nil {
			newCheckpoint = strconv.FormatInt(rowID, 10)
			continue
		}

		// Check blocklist
		if s.isBlocked(identifier) {
			newCheckpoint = strconv.FormatInt(rowID, 10)
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
			Timestamp:         timestamp.Format(time.RFC3339),
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
		newCheckpoint = strconv.FormatInt(rowID, 10)
	}

	return comms, newCheckpoint, nil
}

func (s *Source) parseIdentifier(handleID string) *api.ContactIdentifier {
	if handleID == "" {
		return nil
	}

	// Phone number
	if strings.HasPrefix(handleID, "+") || strings.HasPrefix(handleID, "1") || len(handleID) == 10 {
		normalized := normalizePhone(handleID)
		if normalized != "" {
			return &api.ContactIdentifier{Type: "phone", Value: normalized}
		}
	}

	// Email
	if strings.Contains(handleID, "@") {
		return &api.ContactIdentifier{Type: "email", Value: strings.ToLower(handleID)}
	}

	return nil
}

func normalizePhone(phone string) string {
	// Remove all non-digit characters
	digits := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, phone)

	// Handle US numbers
	if len(digits) == 10 {
		return "+1" + digits
	}
	if len(digits) == 11 && digits[0] == '1' {
		return "+" + digits
	}
	if len(digits) > 10 {
		return "+" + digits
	}

	return ""
}

func (s *Source) isBlocked(id *api.ContactIdentifier) bool {
	if id.Type == "phone" {
		for _, blocked := range s.blocklist.Phones {
			// Normalize blocked number for comparison
			normalizedBlocked := normalizePhone(blocked)
			if normalizedBlocked != "" && id.Value == normalizedBlocked {
				return true
			}
			// Also check partial match
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

		// Expand ~ in filename
		filePath := filename.String
		if strings.HasPrefix(filePath, "~") {
			home, _ := os.UserHomeDir()
			filePath = filepath.Join(home, filePath[1:])
		}

		// Read file and encode as base64
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
