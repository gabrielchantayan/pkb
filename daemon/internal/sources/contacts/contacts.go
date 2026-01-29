package contacts

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"

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

// ContactImport represents a contact to be imported
type ContactImport struct {
	SourceID    string
	DisplayName string
	Emails      []string
	Phones      []string
	Facts       []Fact
	Note        string
	PhotoData   []byte
}

// Fact represents a piece of information about a contact
type Fact struct {
	Type  string
	Value string
}

// SyncContacts fetches all contacts from the AddressBook database
// Contacts are synced differently - they create/update contacts, not communications
func (s *Source) SyncContacts(ctx context.Context) ([]ContactImport, error) {
	db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("failed to open AddressBook database: %w", err)
	}
	defer db.Close()

	// Query contacts
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
		return nil, fmt.Errorf("failed to query contacts: %w", err)
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

		// Skip contacts with no contact info
		if len(emails) == 0 && len(phones) == 0 {
			continue
		}

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
		var email sql.NullString
		rows.Scan(&email)
		if email.Valid && email.String != "" {
			emails = append(emails, strings.ToLower(email.String))
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
		var phone sql.NullString
		rows.Scan(&phone)
		if phone.Valid && phone.String != "" {
			normalized := normalizePhone(phone.String)
			if normalized != "" {
				phones = append(phones, normalized)
			}
		}
	}
	return phones, nil
}

func (s *Source) getPhoto(db *sql.DB, recordPK int64) ([]byte, error) {
	var data []byte
	err := db.QueryRow(`
		SELECT ZDATA FROM ZABCDIMAGE WHERE ZRECORD = ? LIMIT 1
	`, recordPK).Scan(&data)
	if err != nil {
		return nil, err
	}
	return data, nil
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
	return coreDataEpoch.Add(time.Duration(timestamp) * time.Second)
}
