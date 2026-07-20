#!/usr/bin/env bash
# Build and run the docker-compose stack (postgres + minio) in the foreground.
# Ctrl+C (SIGINT) stops the containers cleanly.
set -euo pipefail
cd "$(dirname "$0")"

cleanup() {
	echo
	echo 'Stopping docker compose services...'
	docker compose stop
}
trap cleanup INT TERM

docker compose up --build "$@" &
wait $!
