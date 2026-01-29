package sources

import (
	"context"

	"pkb-daemon/internal/api"
)

// Source defines the interface that all data sources must implement
type Source interface {
	// Name returns the unique identifier for this source
	Name() string

	// Sync fetches communications from the source starting from the given checkpoint.
	// Returns the fetched communications, the new checkpoint, and any error.
	// The checkpoint is source-specific and allows for incremental syncing.
	Sync(ctx context.Context, checkpoint string, limit int) ([]api.Communication, string, error)
}
