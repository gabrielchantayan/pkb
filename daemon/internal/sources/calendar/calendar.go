package calendar

import (
	"context"
	"time"

	"pkb-daemon/internal/config"
)

// CalendarEvent represents a calendar event
type CalendarEvent struct {
	SourceID    string
	Provider    string
	Title       string
	Description string
	Location    string
	StartTime   time.Time
	EndTime     time.Time
	AllDay      bool
	Attendees   []string
	CalendarID  string
}

// CalendarProvider is the interface for calendar providers
type CalendarProvider interface {
	Name() string
	GetEvents(ctx context.Context, start, end time.Time) ([]CalendarEvent, error)
}

// Source aggregates multiple calendar providers
type Source struct {
	providers     []CalendarProvider
	lookbackDays  int
	lookaheadDays int
}

// New creates a new calendar source with configured providers
func New(cfg config.CalendarConfig) (*Source, error) {
	var providers []CalendarProvider

	for _, provCfg := range cfg.Providers {
		switch provCfg.Type {
		case "google":
			provider, err := NewGoogleProvider(provCfg.CredentialsPath, provCfg.TokenPath)
			if err != nil {
				return nil, err
			}
			providers = append(providers, provider)
		case "apple":
			provider, err := NewAppleProvider()
			if err != nil {
				return nil, err
			}
			providers = append(providers, provider)
		}
	}

	return &Source{
		providers:     providers,
		lookbackDays:  cfg.LookbackDays,
		lookaheadDays: cfg.LookaheadDays,
	}, nil
}

func (s *Source) Name() string {
	return "calendar"
}

// Sync fetches events from all providers within the configured time range
func (s *Source) Sync(ctx context.Context, checkpoint string) ([]CalendarEvent, string, error) {
	start := time.Now().AddDate(0, 0, -s.lookbackDays)
	end := time.Now().AddDate(0, 0, s.lookaheadDays)

	var allEvents []CalendarEvent

	for _, provider := range s.providers {
		events, err := provider.GetEvents(ctx, start, end)
		if err != nil {
			// Log but continue with other providers
			continue
		}
		allEvents = append(allEvents, events...)
	}

	return allEvents, time.Now().Format(time.RFC3339), nil
}
