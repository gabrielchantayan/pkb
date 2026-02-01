package contacts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"github.com/rs/zerolog/log"

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

// SyncContacts fetches all contacts - tries AppleScript first, falls back to SQLite
// Contacts are synced differently - they create/update contacts, not communications
func (s *Source) SyncContacts(ctx context.Context) ([]ContactImport, error) {
	// Try AppleScript first (works with iCloud contacts)
	imports, err := s.syncContactsViaAppleScript(ctx)
	if err != nil {
		log.Warn().Err(err).Msg("AppleScript contacts sync failed, falling back to SQLite")
		return s.syncContactsViaSQLite(ctx)
	}
	return imports, nil
}

// syncContactsViaAppleScript uses JXA to read contacts from Contacts.app
func (s *Source) syncContactsViaAppleScript(ctx context.Context) ([]ContactImport, error) {
	// JXA script to export contacts as JSON
	script := `
		const app = Application('Contacts');
		const people = app.people();
		const contacts = [];

		for (let i = 0; i < people.length; i++) {
			const p = people[i];
			const contact = {
				id: p.id(),
				firstName: p.firstName() || '',
				lastName: p.lastName() || '',
				organization: p.organization() || '',
				jobTitle: p.jobTitle() || '',
				note: p.note() || '',
				phones: [],
				emails: []
			};

			// Get phone numbers
			const phones = p.phones();
			for (let j = 0; j < phones.length; j++) {
				contact.phones.push(phones[j].value());
			}

			// Get emails
			const emails = p.emails();
			for (let j = 0; j < emails.length; j++) {
				contact.emails.push(emails[j].value());
			}

			// Only include contacts with contact info
			if (contact.phones.length > 0 || contact.emails.length > 0) {
				contacts.push(contact);
			}
		}

		JSON.stringify(contacts);
	`

	cmd := exec.CommandContext(ctx, "osascript", "-l", "JavaScript", "-e", script)
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to run AppleScript: %w", err)
	}

	// Parse JSON output
	var jsContacts []struct {
		ID           string   `json:"id"`
		FirstName    string   `json:"firstName"`
		LastName     string   `json:"lastName"`
		Organization string   `json:"organization"`
		JobTitle     string   `json:"jobTitle"`
		Note         string   `json:"note"`
		Phones       []string `json:"phones"`
		Emails       []string `json:"emails"`
	}

	if err := json.Unmarshal(output, &jsContacts); err != nil {
		return nil, fmt.Errorf("failed to parse contacts JSON: %w", err)
	}

	var imports []ContactImport
	for _, c := range jsContacts {
		displayName := strings.TrimSpace(c.FirstName + " " + c.LastName)
		if displayName == "" {
			displayName = c.Organization
		}
		if displayName == "" {
			continue
		}

		contact := ContactImport{
			SourceID:    "contacts:" + c.ID,
			DisplayName: displayName,
			Note:        c.Note,
		}

		// Normalize emails
		for _, email := range c.Emails {
			contact.Emails = append(contact.Emails, strings.ToLower(email))
		}

		// Normalize phones
		for _, phone := range c.Phones {
			normalized := normalizePhone(phone)
			if normalized != "" {
				contact.Phones = append(contact.Phones, normalized)
			}
		}

		// Add facts
		if c.Organization != "" {
			contact.Facts = append(contact.Facts, Fact{Type: "company", Value: c.Organization})
		}
		if c.JobTitle != "" {
			contact.Facts = append(contact.Facts, Fact{Type: "job_title", Value: c.JobTitle})
		}

		imports = append(imports, contact)
	}

	log.Info().Int("count", len(imports)).Msg("Fetched contacts via AppleScript")
	return imports, nil
}

// syncContactsViaSQLite fetches contacts from the local AddressBook database
func (s *Source) syncContactsViaSQLite(ctx context.Context) ([]ContactImport, error) {
	db, err := sql.Open("sqlite3", s.dbPath+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("failed to open AddressBook database: %w", err)
	}
	defer db.Close()

	// Query contacts (ZFIRSTNAME or ZLASTNAME indicates person records)
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
		WHERE r.ZFIRSTNAME IS NOT NULL OR r.ZLASTNAME IS NOT NULL OR r.ZORGANIZATION IS NOT NULL
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
