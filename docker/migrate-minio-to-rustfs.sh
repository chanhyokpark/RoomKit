#!/usr/bin/env bash
# One-off: copy the local docker-compose MinIO bucket into RustFS.
#
# Pre-RustFS checkouts left a `<project>_minio-data` volume behind. This boots
# the old data on a throwaway MinIO container (no published ports), starts the
# new rustfs service, and rclone-syncs the roomkit bucket across. Re-runnable.
# The old volume is left in place; delete it yourself once you're satisfied.
set -euo pipefail
cd "$(dirname "$0")/.."

ACCESS_KEY=roomkit
SECRET_KEY=roomkit123
BUCKET=roomkit

old_volume="$(docker volume ls -q | grep -E '_minio-data$' | head -1 || true)"
if [[ -z "$old_volume" ]]; then
	echo 'No *_minio-data volume found — nothing to migrate.' >&2
	exit 1
fi
if ! docker image inspect minio/minio >/dev/null 2>&1; then
	echo 'minio/minio image is not present locally and may no longer be pullable.' >&2
	echo 'Copy /data out of the volume by hand instead (docker run -v "$old_volume":/data ...).' >&2
	exit 1
fi

# Old compose-managed minio containers hold the volume — drop them
# (--remove-orphans also removes them, since the service no longer exists).
docker compose up -d --remove-orphans rustfs createbucket
network="$(docker inspect -f '{{range $k, $_ := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q rustfs)")"

docker rm -f minio-old >/dev/null 2>&1 || true
docker run -d --name minio-old --network "$network" \
	-v "$old_volume":/data \
	-e MINIO_ROOT_USER="$ACCESS_KEY" -e MINIO_ROOT_PASSWORD="$SECRET_KEY" \
	minio/minio server /data >/dev/null
trap 'docker rm -f minio-old >/dev/null 2>&1 || true' EXIT

rclone() {
	docker run --rm --network "$network" \
		-e RCLONE_CONFIG_SRC_TYPE=s3 -e RCLONE_CONFIG_SRC_PROVIDER=Minio \
		-e RCLONE_CONFIG_SRC_ENDPOINT=http://minio-old:9000 \
		-e RCLONE_CONFIG_SRC_ACCESS_KEY_ID="$ACCESS_KEY" -e RCLONE_CONFIG_SRC_SECRET_ACCESS_KEY="$SECRET_KEY" \
		-e RCLONE_CONFIG_DST_TYPE=s3 -e RCLONE_CONFIG_DST_PROVIDER=Other \
		-e RCLONE_CONFIG_DST_ENDPOINT=http://rustfs:9000 \
		-e RCLONE_CONFIG_DST_ACCESS_KEY_ID="$ACCESS_KEY" -e RCLONE_CONFIG_DST_SECRET_ACCESS_KEY="$SECRET_KEY" \
		rclone/rclone "$@"
}

until rclone lsd src: >/dev/null 2>&1; do echo 'waiting for minio-old...'; sleep 1; done

echo "== source ($old_volume)"; rclone size "src:$BUCKET"
rclone sync "src:$BUCKET" "dst:$BUCKET" --size-only --fast-list --transfers 4 --stats 10s --stats-one-line
rclone check "src:$BUCKET" "dst:$BUCKET" --fast-list
echo '== destination (rustfs)'; rclone size "dst:$BUCKET"

echo
echo "Done. The old volume is untouched; remove it with: docker volume rm $old_volume"
