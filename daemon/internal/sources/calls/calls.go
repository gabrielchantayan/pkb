package calls

import (
	"context"
	"database/sql"
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
		return nil, checkpoint, fmt.Errorf("failed to open CallHistory database: %w", err)
	}
	defer db.Close()

	var lastRowID int64 = 0
	if checkpoint != "" {
		lastRowID, _ = strconv.ParseInt(checkpoint, 10, 64)
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
		return nil, checkpoint, fmt.Errorf("failed to query calls: %w", err)
	}
	defer rows.Close()

	var comms []api.Communication
	newCheckpoint := checkpoint

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

		newCheckpoint = strconv.FormatInt(pk, 10)

		if !address.Valid || address.String == "" {
			continue
		}

		phone := normalizePhone(address.String)
		if phone == "" {
			continue
		}

		if s.isBlocked(phone) {
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

		durationSecs := int(duration.Float64)
		content := fmt.Sprintf("%s call", status)
		if durationSecs > 0 {
			content = fmt.Sprintf("%s call, %s", status, formatDuration(durationSecs))
		}

		comm := api.Communication{
			Source:   "calls",
			SourceID: fmt.Sprintf("call:%d", pk),
			ContactIdentifier: api.ContactIdentifier{
				Type:  "phone",
				Value: phone,
			},
			Direction: direction,
			Content:   content,
			Timestamp: timestamp.Format(time.RFC3339),
			Metadata: map[string]interface{}{
				"duration_seconds": duration.Float64,
				"status":           status,
			},
		}

		comms = append(comms, comm)
	}

	return comms, newCheckpoint, nil
}

func (s *Source) isBlocked(phone string) bool {
	for _, blocked := range s.blocklist.Phones {
		normalizedBlocked := normalizePhone(blocked)
		if normalizedBlocked != "" && phone == normalizedBlocked {
			return true
		}
		// Also check partial match (last 10 digits)
		if len(phone) >= 10 && len(blocked) >= 10 {
			phoneSuffix := phone[len(phone)-10:]
			blockedDigits := strings.Map(func(r rune) rune {
				if r >= '0' && r <= '9' {
					return r
				}
				return -1
			}, blocked)
			if len(blockedDigits) >= 10 && phoneSuffix == blockedDigits[len(blockedDigits)-10:] {
				return true
			}
		}
	}
	return false
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

func coreDataTimestampToTime(timestamp float64) time.Time {
	// Core Data timestamps are seconds since 2001-01-01
	coreDataEpoch := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	return coreDataEpoch.Add(time.Duration(timestamp * float64(time.Second)))
}

func expandPath(path string) string {
	if strings.HasPrefix(path, "~") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[1:])
	}
	return path
}

func formatDuration(seconds int) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds", seconds)
	}
	minutes := seconds / 60
	secs := seconds % 60
	if secs == 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%dm %ds", minutes, secs)
}
