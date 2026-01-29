package gmail

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"google.golang.org/api/gmail/v1"

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
	name      string
	service   *gmail.Service
	userEmail string
}

func New(cfg config.GmailConfig, blocklist config.BlocklistConfig) (*Source, error) {
	var accounts []*Account

	for _, acctCfg := range cfg.Accounts {
		service, err := createGmailService(acctCfg.CredentialsPath, acctCfg.TokenPath)
		if err != nil {
			return nil, fmt.Errorf("failed to create Gmail service for %s: %w", acctCfg.Name, err)
		}

		// Get user's email address
		profile, err := service.Users.GetProfile("me").Do()
		if err != nil {
			return nil, fmt.Errorf("failed to get profile for %s: %w", acctCfg.Name, err)
		}

		accounts = append(accounts, &Account{
			name:      acctCfg.Name,
			service:   service,
			userEmail: profile.EmailAddress,
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
	// Parse checkpoint: "accountName:pageToken"
	currentAccount, pageToken := parseCheckpoint(checkpoint)

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

		// Reset page token for new accounts
		token := ""
		if acct.name == currentAccount {
			token = pageToken
		}

		messages, nextToken, err := s.syncAccount(ctx, acct, token, remaining)
		if err != nil {
			return comms, newCheckpoint, err
		}

		comms = append(comms, messages...)
		remaining -= len(messages)

		if nextToken != "" {
			// More messages in this account
			newCheckpoint = fmt.Sprintf("%s:%s", acct.name, nextToken)
			break
		} else if i+1 < len(s.accounts) {
			// Move to next account
			newCheckpoint = fmt.Sprintf("%s:", s.accounts[i+1].name)
		} else {
			// All accounts done
			newCheckpoint = checkpoint
		}
	}

	return comms, newCheckpoint, nil
}

func (s *Source) syncAccount(ctx context.Context, acct *Account, pageToken string, limit int) ([]api.Communication, string, error) {
	query := ""
	if !s.startDate.IsZero() {
		query = fmt.Sprintf("after:%s", s.startDate.Format("2006/01/02"))
	}

	req := acct.service.Users.Messages.List("me").Q(query).MaxResults(int64(limit))
	if pageToken != "" {
		req = req.PageToken(pageToken)
	}

	resp, err := req.Context(ctx).Do()
	if err != nil {
		return nil, pageToken, err
	}

	var comms []api.Communication

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
			continue
		}

		comm, err := s.parseMessage(full, acct)
		if err != nil {
			continue
		}

		if s.isBlocked(comm.ContactIdentifier.Value) {
			continue
		}

		comms = append(comms, *comm)
	}

	return comms, resp.NextPageToken, nil
}

func (s *Source) parseMessage(msg *gmail.Message, acct *Account) (*api.Communication, error) {
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

	var direction string
	var contactEmail string

	if strings.EqualFold(fromEmail, acct.userEmail) {
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
		SourceID: fmt.Sprintf("%s:%s", acct.name, msg.Id),
		ContactIdentifier: api.ContactIdentifier{
			Type:  "email",
			Value: strings.ToLower(contactEmail),
		},
		Direction: direction,
		Subject:   headers["subject"],
		Content:   body,
		Timestamp: timestamp.Format(time.RFC3339),
		ThreadID:  msg.ThreadId,
		Metadata: map[string]interface{}{
			"account": acct.name,
			"labels":  msg.LabelIds,
			"snippet": msg.Snippet,
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

	// Fallback to HTML (strip tags)
	for _, part := range payload.Parts {
		if part.MimeType == "text/html" {
			data, _ := base64.URLEncoding.DecodeString(part.Body.Data)
			return stripHTML(string(data))
		}
	}

	// Check nested parts (multipart/alternative inside multipart/mixed)
	for _, part := range payload.Parts {
		if len(part.Parts) > 0 {
			if body := extractBody(part); body != "" {
				return body
			}
		}
	}

	return ""
}

func stripHTML(html string) string {
	// Simple HTML tag removal
	var result strings.Builder
	inTag := false

	for _, r := range html {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			continue
		}
		if !inTag {
			result.WriteRune(r)
		}
	}

	return strings.TrimSpace(result.String())
}

func parseEmailAddress(addr string) string {
	// Handle "Name <email@example.com>" format
	if start := strings.Index(addr, "<"); start != -1 {
		if end := strings.Index(addr, ">"); end != -1 {
			return strings.TrimSpace(addr[start+1 : end])
		}
	}
	return strings.TrimSpace(addr)
}

func parseCheckpoint(checkpoint string) (account, pageToken string) {
	if checkpoint == "" {
		return "", ""
	}
	parts := strings.SplitN(checkpoint, ":", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return parts[0], ""
}

func (s *Source) isBlocked(email string) bool {
	for _, blocked := range s.blocklist.Emails {
		if strings.EqualFold(email, blocked) {
			return true
		}
	}
	return false
}
