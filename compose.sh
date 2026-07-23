#!/usr/bin/env bash
# Build and run the docker-compose stack (postgres + minio + server + studio)
# in the foreground. Ctrl+C (SIGINT) stops the containers cleanly.
# For infra only (postgres + minio, e.g. alongside host dev servers), run
# `docker compose up` directly — server/studio sit behind the "app" profile.
set -euo pipefail
cd "$(dirname "$0")"

# Applies to every compose invocation below, including the stop in cleanup.
export COMPOSE_PROFILES=app

cleanup() {
	echo
	echo 'Stopping docker compose services...'
	docker compose stop
}
trap cleanup INT TERM

docker compose up --build "$@" &
wait $!
