package calendar

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

// GoogleProvider implements CalendarProvider for Google Calendar
type GoogleProvider struct {
	service *calendar.Service
}

// NewGoogleProvider creates a new Google Calendar provider
func NewGoogleProvider(credentialsPath, tokenPath string) (*GoogleProvider, error) {
	ctx := context.Background()

	// Read credentials file
	credBytes, err := os.ReadFile(credentialsPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read credentials file: %w", err)
	}

	config, err := google.ConfigFromJSON(credBytes, calendar.CalendarReadonlyScope)
	if err != nil {
		return nil, fmt.Errorf("unable to parse credentials: %w", err)
	}

	// Read token file
	token, err := tokenFromFile(tokenPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read token file (run 'pkb-daemon oauth gcal' to authenticate): %w", err)
	}

	client := config.Client(ctx, token)
	service, err := calendar.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("unable to create Calendar service: %w", err)
	}

	return &GoogleProvider{service: service}, nil
}

func (p *GoogleProvider) Name() string {
	return "google"
}

func (p *GoogleProvider) GetEvents(ctx context.Context, start, end time.Time) ([]CalendarEvent, error) {
	events, err := p.service.Events.List("primary").
		TimeMin(start.Format(time.RFC3339)).
		TimeMax(end.Format(time.RFC3339)).
		SingleEvents(true).
		OrderBy("startTime").
		MaxResults(2500).
		Context(ctx).
		Do()

	if err != nil {
		return nil, fmt.Errorf("failed to fetch Google Calendar events: %w", err)
	}

	var result []CalendarEvent
	for _, e := range events.Items {
		event := CalendarEvent{
			SourceID:    fmt.Sprintf("gcal:%s", e.Id),
			Provider:    "google",
			Title:       e.Summary,
			Description: e.Description,
			Location:    e.Location,
			Attendees:   []string{},
		}

		// Parse times
		if e.Start.DateTime != "" {
			event.StartTime, _ = time.Parse(time.RFC3339, e.Start.DateTime)
		} else if e.Start.Date != "" {
			event.StartTime, _ = time.Parse("2006-01-02", e.Start.Date)
			event.AllDay = true
		}

		if e.End.DateTime != "" {
			event.EndTime, _ = time.Parse(time.RFC3339, e.End.DateTime)
		} else if e.End.Date != "" {
			event.EndTime, _ = time.Parse("2006-01-02", e.End.Date)
		}

		// Extract attendee emails
		for _, att := range e.Attendees {
			if att.Email != "" && !att.Self {
				event.Attendees = append(event.Attendees, att.Email)
			}
		}

		result = append(result, event)
	}

	return result, nil
}

func tokenFromFile(path string) (*oauth2.Token, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	token := &oauth2.Token{}
	err = json.NewDecoder(f).Decode(token)
	return token, err
}
