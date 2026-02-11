#!/usr/bin/env bash
set -e

# Clear the terminal
clear && clear

docker compose up -d db

exec npx concurrently \
  -n backend,frontend \
  -c blue,green \
  "yarn workspace @pkb/backend dev" \
  "yarn workspace @pkb/frontend dev"
