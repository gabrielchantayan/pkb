package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Error types for retry classification
var (
	// ErrTemporary indicates a temporary error that should be retried
	ErrTemporary = errors.New("temporary error")
	// ErrPermanent indicates a permanent error that should not be retried
	ErrPermanent = errors.New("permanent error")
)

// APIError wraps an error with retry information
type APIError struct {
	StatusCode int
	Message    string
	Temporary  bool
}

func (e *APIError) Error() string {
	return fmt.Sprintf("API error %d: %s", e.StatusCode, e.Message)
}

func (e *APIError) Unwrap() error {
	if e.Temporary {
		return ErrTemporary
	}
	return ErrPermanent
}

// IsTemporaryError returns true if the error should be retried
func IsTemporaryError(err error) bool {
	if err == nil {
		return false
	}
	// Network errors are generally temporary
	if errors.Is(err, ErrTemporary) {
		return true
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Temporary
	}
	// Connection errors, timeouts, etc. are temporary
	return true
}

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
	Timestamp         string                 `json:"timestamp"` // ISO 8601 datetime
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
	Inserted int          `json:"inserted"`
	Updated  int          `json:"updated"`
	Errors   []BatchError `json:"errors"`
}

type BatchError struct {
	Index int    `json:"index"`
	Error string `json:"error"`
}

func (c *Client) BatchUpsert(comms []Communication) (*BatchUpsertResponse, error) {
	body, err := json.Marshal(BatchUpsertRequest{Communications: comms})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.post("/api/communications/batch", body)
	if err != nil {
		// Network errors are temporary
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, &APIError{
			StatusCode: resp.StatusCode,
			Message:    string(bodyBytes),
			Temporary:  isTemporaryStatusCode(resp.StatusCode),
		}
	}

	var result BatchUpsertResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// isTemporaryStatusCode returns true for status codes that indicate temporary issues
func isTemporaryStatusCode(code int) bool {
	switch code {
	case http.StatusTooManyRequests,      // 429 - Rate limited
		http.StatusInternalServerError,   // 500
		http.StatusBadGateway,            // 502
		http.StatusServiceUnavailable,    // 503
		http.StatusGatewayTimeout:        // 504
		return true
	default:
		return false
	}
}

func (c *Client) get(path string) (*http.Response, error) {
	req, err := http.NewRequest("GET", c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("X-API-Key", c.apiKey)
	return c.httpClient.Do(req)
}

func (c *Client) post(path string, body []byte) (*http.Response, error) {
	req, err := http.NewRequest("POST", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("X-API-Key", c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	return c.httpClient.Do(req)
}

// ContactImport represents a contact to be imported
type ContactImport struct {
	SourceID    string `json:"source_id"`
	DisplayName string `json:"display_name"`
	Emails      []string `json:"emails,omitempty"`
	Phones      []string `json:"phones,omitempty"`
	Facts       []ContactFact `json:"facts,omitempty"`
	Note        string `json:"note,omitempty"`
	PhotoData   string `json:"photo_data,omitempty"` // base64
}

type ContactFact struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type ContactsImportRequest struct {
	Contacts []ContactImport `json:"contacts"`
}

type ContactsImportResponse struct {
	Created int          `json:"created"`
	Updated int          `json:"updated"`
	Merged  int          `json:"merged"`
	Errors  []BatchError `json:"errors"`
}

func (c *Client) ImportContacts(imports []ContactImport) (*ContactsImportResponse, error) {
	body, err := json.Marshal(ContactsImportRequest{Contacts: imports})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.post("/api/sync/contacts", body)
	if err != nil {
		// Network errors are temporary
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, &APIError{
			StatusCode: resp.StatusCode,
			Message:    string(bodyBytes),
			Temporary:  isTemporaryStatusCode(resp.StatusCode),
		}
	}

	var result ContactsImportResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// BatchUpsertFromPayload processes a batch upsert from a queued request payload
func (c *Client) BatchUpsertFromPayload(payload []byte) error {
	var req BatchUpsertRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}
	_, err := c.BatchUpsert(req.Communications)
	return err
}

// ImportContactsFromPayload processes a contacts import from a queued request payload
func (c *Client) ImportContactsFromPayload(payload []byte) error {
	var req ContactsImportRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}
	_, err := c.ImportContacts(req.Contacts)
	return err
}

// CalendarEventImport represents a calendar event to be imported
type CalendarEventImport struct {
	SourceID    string   `json:"source_id"`
	Provider    string   `json:"provider"`
	Title       string   `json:"title"`
	Description string   `json:"description,omitempty"`
	Location    string   `json:"location,omitempty"`
	StartTime   string   `json:"start_time"` // ISO 8601
	EndTime     string   `json:"end_time,omitempty"`
	AllDay      bool     `json:"all_day,omitempty"`
	Attendees   []string `json:"attendees,omitempty"` // email addresses
	CalendarID  string   `json:"calendar_id,omitempty"`
}

type CalendarEventsRequest struct {
	Events []CalendarEventImport `json:"events"`
}

type CalendarEventsResponse struct {
	Inserted int          `json:"inserted"`
	Updated  int          `json:"updated"`
	Errors   []BatchError `json:"errors"`
}

func (c *Client) ImportCalendarEvents(events []CalendarEventImport) (*CalendarEventsResponse, error) {
	body, err := json.Marshal(CalendarEventsRequest{Events: events})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.post("/api/sync/calendar", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, &APIError{
			StatusCode: resp.StatusCode,
			Message:    string(bodyBytes),
			Temporary:  isTemporaryStatusCode(resp.StatusCode),
		}
	}

	var result CalendarEventsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// AppleNoteImport represents an Apple Note to be imported
type AppleNoteImport struct {
	SourceID  string `json:"source_id"`
	Title     string `json:"title,omitempty"`
	Content   string `json:"content,omitempty"`
	Folder    string `json:"folder,omitempty"`
	CreatedAt string `json:"created_at,omitempty"` // ISO 8601
	UpdatedAt string `json:"updated_at,omitempty"` // ISO 8601
}

type AppleNotesRequest struct {
	Notes []AppleNoteImport `json:"notes"`
}

type AppleNotesResponse struct {
	Inserted int          `json:"inserted"`
	Updated  int          `json:"updated"`
	Errors   []BatchError `json:"errors"`
}

func (c *Client) ImportAppleNotes(notes []AppleNoteImport) (*AppleNotesResponse, error) {
	body, err := json.Marshal(AppleNotesRequest{Notes: notes})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	resp, err := c.post("/api/sync/notes", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, &APIError{
			StatusCode: resp.StatusCode,
			Message:    string(bodyBytes),
			Temporary:  isTemporaryStatusCode(resp.StatusCode),
		}
	}

	var result AppleNotesResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// ImportCalendarEventsFromPayload processes a calendar events import from a queued request payload
func (c *Client) ImportCalendarEventsFromPayload(payload []byte) error {
	var req CalendarEventsRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}
	_, err := c.ImportCalendarEvents(req.Events)
	return err
}

// ImportAppleNotesFromPayload processes an Apple Notes import from a queued request payload
func (c *Client) ImportAppleNotesFromPayload(payload []byte) error {
	var req AppleNotesRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}
	_, err := c.ImportAppleNotes(req.Notes)
	return err
}
