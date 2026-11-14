#!/usr/bin/env sh
set -eu

AEBHASH=$(git rev-parse --short HEAD)
docker build -t "darkcheyenne/eberli-hotel-mcp:${AEBHASH}" -t "darkcheyenne/eberli-hotel-mcp:latest" .
