package sync

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type State struct {
	path        string
	mu          sync.RWMutex
	checkpoints map[string]string
}

func NewState(path string) *State {
	return &State{
		path:        path,
		checkpoints: make(map[string]string),
	}
}

func (s *State) Load() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // No state file yet, that's ok
		}
		return err
	}

	return json.Unmarshal(data, &s.checkpoints)
}

func (s *State) Save() error {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Ensure directory exists
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	data, err := json.MarshalIndent(s.checkpoints, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, data, 0644)
}

func (s *State) GetCheckpoint(source string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.checkpoints[source]
}

func (s *State) SetCheckpoint(source, checkpoint string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.checkpoints[source] = checkpoint
}
