package calendar

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// AppleProvider implements CalendarProvider for Apple Calendar via SQLite
type AppleProvider struct {
	dbPath string
}

// NewAppleProvider creates a new Apple Calendar provider
func NewAppleProvider() (*AppleProvider, error) {
	home, _ := os.UserHomeDir()
	dbPath := filepath.Join(home, "Library/Calendars/Calendar.sqlitedb")

	// Verify file exists
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("Apple Calendar database not found at %s", dbPath)
	}

	return &AppleProvider{dbPath: dbPath}, nil
}

func (p *AppleProvider) Name() string {
	return "apple"
}

func (p *AppleProvider) GetEvents(ctx context.Context, start, end time.Time) ([]CalendarEvent, error) {
	db, err := sql.Open("sqlite3", p.dbPath+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("failed to open Calendar database: %w", err)
	}
	defer db.Close()

	// Convert times to Core Data timestamps
	startTS := timeToCoreDataTimestamp(start)
	endTS := timeToCoreDataTimestamp(end)

	// Query events
	query := `
		SELECT
			ci.Z_PK,
			ci.ZTITLE,
			ci.ZLOCATION,
			ci.ZNOTES,
			ci.ZSTARTDATE,
			ci.ZENDDATE,
			ci.ZALLDAY,
			c.ZTITLE as calendar_title
		FROM ZCALENDARITEM ci
		LEFT JOIN ZCALENDAR c ON ci.ZCALENDAR = c.Z_PK
		WHERE ci.ZSTARTDATE >= ? AND ci.ZSTARTDATE <= ?
		ORDER BY ci.ZSTARTDATE ASC
	`

	rows, err := db.QueryContext(ctx, query, startTS, endTS)
	if err != nil {
		return nil, fmt.Errorf("failed to query events: %w", err)
	}
	defer rows.Close()

	var events []CalendarEvent

	for rows.Next() {
		var pk int64
		var title, location, notes, calendarTitle sql.NullString
		var startDate, endDate sql.NullFloat64
		var allDay sql.NullInt64

		err := rows.Scan(&pk, &title, &location, &notes, &startDate, &endDate, &allDay, &calendarTitle)
		if err != nil {
			continue
		}

		if !title.Valid || title.String == "" {
			continue
		}

		event := CalendarEvent{
			SourceID:    fmt.Sprintf("acal:%d", pk),
			Provider:    "apple",
			Title:       title.String,
			Location:    location.String,
			Description: notes.String,
			AllDay:      allDay.Int64 == 1,
			Attendees:   []string{},
		}

		if startDate.Valid {
			event.StartTime = coreDataTimestampToTime(startDate.Float64)
		}
		if endDate.Valid {
			event.EndTime = coreDataTimestampToTime(endDate.Float64)
		}

		// Get attendees
		attendees, _ := p.getAttendees(db, pk)
		event.Attendees = attendees

		if calendarTitle.Valid {
			event.CalendarID = calendarTitle.String
		}

		events = append(events, event)
	}

	return events, nil
}

func (p *AppleProvider) getAttendees(db *sql.DB, eventPK int64) ([]string, error) {
	rows, err := db.Query(`
		SELECT ZEMAIL FROM ZATTENDEE WHERE ZEVENT = ?
	`, eventPK)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var attendees []string
	for rows.Next() {
		var email sql.NullString
		rows.Scan(&email)
		if email.Valid && email.String != "" && strings.Contains(email.String, "@") {
			attendees = append(attendees, strings.ToLower(email.String))
		}
	}
	return attendees, nil
}

func coreDataTimestampToTime(timestamp float64) time.Time {
	// Core Data timestamps are seconds since 2001-01-01
	coreDataEpoch := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	return coreDataEpoch.Add(time.Duration(timestamp * float64(time.Second)))
}

func timeToCoreDataTimestamp(t time.Time) float64 {
	coreDataEpoch := time.Date(2001, 1, 1, 0, 0, 0, 0, time.UTC)
	return t.Sub(coreDataEpoch).Seconds()
}
