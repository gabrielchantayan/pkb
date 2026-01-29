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
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("batch upsert failed: %d - %s", resp.StatusCode, string(bodyBytes))
	}

	var result BatchUpsertResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
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
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("contacts import failed: %d - %s", resp.StatusCode, string(bodyBytes))
	}

	var result ContactsImportResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}
