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
	Blocklist BlocklistConfig `yaml:"blocklist"`
	Logging   LoggingConfig   `yaml:"logging"`
	State     StateConfig     `yaml:"state"`
}

type BackendConfig struct {
	URL    string `yaml:"url"`
	APIKey string `yaml:"api_key"`
}

type SourcesConfig struct {
	IMessage IMessageConfig `yaml:"imessage"`
}

type IMessageConfig struct {
	Enabled   bool   `yaml:"enabled"`
	DBPath    string `yaml:"db_path"`
	StartDate string `yaml:"start_date"`
}

type SyncConfig struct {
	IntervalSeconds int `yaml:"interval_seconds"`
	BatchSize       int `yaml:"batch_size"`
	MaxPerCycle     int `yaml:"max_per_cycle"`
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
	if cfg.State.Path == "" {
		home, _ := os.UserHomeDir()
		cfg.State.Path = filepath.Join(home, ".pkb-daemon", "state.json")
	} else {
		cfg.State.Path = expandPath(cfg.State.Path)
	}

	// Expand paths
	if cfg.Sources.IMessage.DBPath != "" {
		cfg.Sources.IMessage.DBPath = expandPath(cfg.Sources.IMessage.DBPath)
	}
	if cfg.Logging.Path != "" {
		cfg.Logging.Path = expandPath(cfg.Logging.Path)
	}

	return &cfg, nil
}
