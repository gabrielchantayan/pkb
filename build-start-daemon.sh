#!/usr/bin/env bash
set -e

cd daemon
make clean
make build
exec ./build/pkb-daemon
