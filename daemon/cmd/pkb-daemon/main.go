package main

import (
	"context"
	"flag"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"pkb-daemon/internal/api"
	"pkb-daemon/internal/config"
	"pkb-daemon/internal/sources/imessage"
	"pkb-daemon/internal/sync"
)

func main() {
	configPath := flag.String("config", "config.yaml", "Path to config file")
	flag.Parse()

	// Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load config")
	}

	// Setup logging
	setupLogging(cfg.Logging)

	log.Info().Msg("Starting PKB daemon")

	// Create API client
	client := api.NewClient(cfg.Backend.URL, cfg.Backend.APIKey)

	// Verify connection
	if err := client.HealthCheck(); err != nil {
		log.Fatal().Err(err).Msg("Backend health check failed")
	}
	log.Info().Str("url", cfg.Backend.URL).Msg("Connected to backend")

	// Create sync manager
	manager := sync.NewManager(client, cfg)

	// Register sources
	if cfg.Sources.IMessage.Enabled {
		src, err := imessage.New(cfg.Sources.IMessage, cfg.Blocklist)
		if err != nil {
			log.Fatal().Err(err).Msg("Failed to initialize iMessage source")
		}
		manager.RegisterSource(src)
	}

	// Handle shutdown gracefully
	ctx, cancel := context.WithCancel(context.Background())
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		log.Info().Msg("Shutting down...")
		cancel()
	}()

	// Start sync loop
	if err := manager.Run(ctx); err != nil {
		log.Fatal().Err(err).Msg("Sync manager failed")
	}

	log.Info().Msg("Daemon stopped")
}

func setupLogging(cfg config.LoggingConfig) {
	// Set log level
	level, err := zerolog.ParseLevel(cfg.Level)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)

	// Configure output
	var output = os.Stdout
	if cfg.Path != "" {
		file, err := os.OpenFile(cfg.Path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
		if err != nil {
			log.Warn().Err(err).Msg("Failed to open log file, using stdout")
		} else {
			output = file
		}
	}

	// Configure format
	if cfg.Format == "console" {
		log.Logger = zerolog.New(zerolog.ConsoleWriter{
			Out:        output,
			TimeFormat: time.RFC3339,
		}).With().Timestamp().Logger()
	} else {
		log.Logger = zerolog.New(output).With().Timestamp().Logger()
	}
}
