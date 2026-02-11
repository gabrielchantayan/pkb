package config

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Backend   BackendConfig   `yaml:"backend"`
	Sources   SourcesConfig   `yaml:"sources"`
	Sync      SyncConfig      `yaml:"sync"`
	Queue     QueueConfig     `yaml:"queue"`
	Blocklist BlocklistConfig `yaml:"blocklist"`
	Logging   LoggingConfig   `yaml:"logging"`
	State     StateConfig     `yaml:"state"`
}

type BackendConfig struct {
	URL    string `yaml:"url"`
	APIKey string `yaml:"api_key"`
}

type SourcesConfig struct {
	IMessage IMessageConfig  `yaml:"imessage"`
	Gmail    GmailConfig     `yaml:"gmail"`
	Contacts ContactsConfig  `yaml:"contacts"`
	Calendar CalendarConfig  `yaml:"calendar"`
	Calls    CallsConfig     `yaml:"calls"`
	Notes    NotesConfig     `yaml:"notes"`
}

type IMessageConfig struct {
	Enabled   bool   `yaml:"enabled"`
	DBPath    string `yaml:"db_path"`
	StartDate string `yaml:"start_date"`
}

type GmailConfig struct {
	Enabled       bool                `yaml:"enabled"`
	Accounts      []GmailAccountConfig `yaml:"accounts"`
	StartDate     string              `yaml:"start_date"`
	Labels        []string            `yaml:"labels"`
	ExcludeLabels []string            `yaml:"exclude_labels"`
}

type GmailAccountConfig struct {
	Name            string `yaml:"name"`
	CredentialsPath string `yaml:"credentials_path"`
	TokenPath       string `yaml:"token_path"`
}

type ContactsConfig struct {
	Enabled      bool   `yaml:"enabled"`
	ImportPhotos bool   `yaml:"import_photos"`
	Source       string `yaml:"source"` // "addressbook" or "carddav"
}

type CalendarConfig struct {
	Enabled       bool                     `yaml:"enabled"`
	Providers     []CalendarProviderConfig `yaml:"providers"`
	LookbackDays  int                      `yaml:"lookback_days"`
	LookaheadDays int                      `yaml:"lookahead_days"`
}

type CalendarProviderConfig struct {
	Type            string `yaml:"type"` // "google" or "apple"
	CredentialsPath string `yaml:"credentials_path"`
	TokenPath       string `yaml:"token_path"`
}

type CallsConfig struct {
	Enabled bool   `yaml:"enabled"`
	DBPath  string `yaml:"db_path"`
}

type NotesConfig struct {
	Enabled bool   `yaml:"enabled"`
	Method  string `yaml:"method"` // "sqlite" or "applescript"
	DBPath  string `yaml:"db_path"`
}

type SyncConfig struct {
	IntervalSeconds         int `yaml:"interval_seconds"`
	ContactsIntervalSeconds int `yaml:"contacts_interval_seconds"`
	BatchSize               int `yaml:"batch_size"`
	MaxPerCycle             int `yaml:"max_per_cycle"`
}

type QueueConfig struct {
	Enabled              bool   `yaml:"enabled"`
	Path                 string `yaml:"path"`
	MaxRetries           int    `yaml:"max_retries"`
	InitialBackoffSecs   int    `yaml:"initial_backoff_seconds"`
	MaxBackoffSecs       int    `yaml:"max_backoff_seconds"`
	BackoffFactor        float64 `yaml:"backoff_factor"`
	ProcessIntervalSecs  int    `yaml:"process_interval_seconds"`
	BatchSize            int    `yaml:"batch_size"`
}

type BlocklistConfig struct {
	Phones []string `yaml:"phones"`
	Emails []string `yaml:"emails"`
	Names  []string `yaml:"names"`
}

type LoggingConfig struct {
	Level  string `yaml:"level"`
	Format string `yaml:"format"`
	Path   string `yaml:"path"`
}

type StateConfig struct {
	Path string `yaml:"path"`
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

func Load(path string) (*Config, error) {
	path = expandPath(path)

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}

	// Set defaults
	if cfg.Sync.IntervalSeconds == 0 {
		cfg.Sync.IntervalSeconds = 60
	}
	if cfg.Sync.BatchSize == 0 {
		cfg.Sync.BatchSize = 100
	}
	if cfg.Sync.MaxPerCycle == 0 {
		cfg.Sync.MaxPerCycle = 1000
	}
	if cfg.Sync.ContactsIntervalSeconds == 0 {
		cfg.Sync.ContactsIntervalSeconds = 900 // 15 minutes
	}
	if cfg.State.Path == "" {
		home, _ := os.UserHomeDir()
		cfg.State.Path = filepath.Join(home, ".pkb-daemon", "state.json")
	} else {
		cfg.State.Path = expandPath(cfg.State.Path)
	}

	// Queue defaults
	if cfg.Queue.Enabled && cfg.Queue.Path == "" {
		home, _ := os.UserHomeDir()
		cfg.Queue.Path = filepath.Join(home, ".pkb-daemon", "queue.db")
	} else if cfg.Queue.Path != "" {
		cfg.Queue.Path = expandPath(cfg.Queue.Path)
	}
	if cfg.Queue.MaxRetries == 0 {
		cfg.Queue.MaxRetries = 10
	}
	if cfg.Queue.InitialBackoffSecs == 0 {
		cfg.Queue.InitialBackoffSecs = 5
	}
	if cfg.Queue.MaxBackoffSecs == 0 {
		cfg.Queue.MaxBackoffSecs = 3600 // 1 hour
	}
	if cfg.Queue.BackoffFactor == 0 {
		cfg.Queue.BackoffFactor = 2.0
	}
	if cfg.Queue.ProcessIntervalSecs == 0 {
		cfg.Queue.ProcessIntervalSecs = 30
	}
	if cfg.Queue.BatchSize == 0 {
		cfg.Queue.BatchSize = 20
	}

	// Expand paths
	if cfg.Sources.IMessage.DBPath != "" {
		cfg.Sources.IMessage.DBPath = expandPath(cfg.Sources.IMessage.DBPath)
	}
	if cfg.Logging.Path != "" {
		cfg.Logging.Path = expandPath(cfg.Logging.Path)
	}

	// Gmail account paths
	for i := range cfg.Sources.Gmail.Accounts {
		if cfg.Sources.Gmail.Accounts[i].CredentialsPath != "" {
			cfg.Sources.Gmail.Accounts[i].CredentialsPath = expandPath(cfg.Sources.Gmail.Accounts[i].CredentialsPath)
		}
		if cfg.Sources.Gmail.Accounts[i].TokenPath != "" {
			cfg.Sources.Gmail.Accounts[i].TokenPath = expandPath(cfg.Sources.Gmail.Accounts[i].TokenPath)
		}
	}

	// Calendar provider paths
	for i := range cfg.Sources.Calendar.Providers {
		if cfg.Sources.Calendar.Providers[i].CredentialsPath != "" {
			cfg.Sources.Calendar.Providers[i].CredentialsPath = expandPath(cfg.Sources.Calendar.Providers[i].CredentialsPath)
		}
		if cfg.Sources.Calendar.Providers[i].TokenPath != "" {
			cfg.Sources.Calendar.Providers[i].TokenPath = expandPath(cfg.Sources.Calendar.Providers[i].TokenPath)
		}
	}

	// Calendar defaults
	if cfg.Sources.Calendar.LookbackDays == 0 {
		cfg.Sources.Calendar.LookbackDays = 365
	}
	if cfg.Sources.Calendar.LookaheadDays == 0 {
		cfg.Sources.Calendar.LookaheadDays = 90
	}

	// Calls DB path
	if cfg.Sources.Calls.DBPath != "" {
		cfg.Sources.Calls.DBPath = expandPath(cfg.Sources.Calls.DBPath)
	}

	// Notes DB path
	if cfg.Sources.Notes.DBPath != "" {
		cfg.Sources.Notes.DBPath = expandPath(cfg.Sources.Notes.DBPath)
	}

	return &cfg, nil
}
