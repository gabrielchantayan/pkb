.PHONY: build clean run test deps

BINARY_NAME=pkb-daemon
BUILD_DIR=./build

# Build the daemon
build:
	CGO_ENABLED=1 go build -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/pkb-daemon

# Build for production (with optimizations)
build-prod:
	CGO_ENABLED=1 go build -ldflags="-s -w" -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/pkb-daemon

# Run the daemon
run:
	go run ./cmd/pkb-daemon -config config.yaml

# Run with example config
run-example:
	go run ./cmd/pkb-daemon -config config.example.yaml

# Install dependencies
deps:
	go mod tidy
	go mod download

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	go clean

# Run tests
test:
	go test -v ./...

# Format code
fmt:
	go fmt ./...

# Lint code (requires golangci-lint)
lint:
	golangci-lint run

# Install to /usr/local/bin
install: build-prod
	cp $(BUILD_DIR)/$(BINARY_NAME) /usr/local/bin/
