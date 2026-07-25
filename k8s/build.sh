#!/usr/bin/env bash
# Build and push the server and studio images for linux/amd64.
# Usage: k8s/build.sh [tag]   (default: latest)
set -euo pipefail
cd "$(dirname "$0")/.."

TAG="${1:-latest}"
REGISTRY=ghcr.io/chanhyokpark
# Baked into the studio client bundle — the server origin as seen by browsers.
PUBLIC_API_URL="${PUBLIC_API_URL:-https://rk.dshs.app}"

echo "Building $REGISTRY/roomkit-server:$TAG"
docker buildx build --platform linux/amd64 \
	-f docker/server.Dockerfile \
	-t "$REGISTRY/roomkit-server:$TAG" \
	--push .

echo "Building $REGISTRY/roomkit-studio:$TAG (PUBLIC_API_URL=$PUBLIC_API_URL)"
docker buildx build --platform linux/amd64 \
	-f docker/studio.Dockerfile \
	--build-arg "PUBLIC_API_URL=$PUBLIC_API_URL" \
	-t "$REGISTRY/roomkit-studio:$TAG" \
	--push .
