#!/usr/bin/env bash
# Deploy RoomKit to the k3s cluster (namespace: roomkit, host: rk.dshs.app).
# Prereqs: images pushed (k8s/build.sh) and k8s/.env.prod filled in
# (see .env.prod.example).
set -euo pipefail
cd "$(dirname "$0")"

NS=roomkit
ENV_FILE="${ENV_FILE:-.env.prod}"

if [[ ! -f "$ENV_FILE" ]]; then
	echo "Missing $ENV_FILE — copy .env.prod.example and fill it in." >&2
	exit 1
fi

kubectl apply -f namespace.yaml

kubectl create secret generic roomkit-secrets \
	--from-env-file="$ENV_FILE" -n "$NS" \
	--dry-run=client -o yaml | kubectl apply -f -

# The completed bucket-init job is immutable — drop it so apply re-creates it.
kubectl delete job minio-init -n "$NS" --ignore-not-found

kubectl apply \
	-f postgres.yaml \
	-f minio.yaml \
	-f server.yaml \
	-f studio.yaml \
	-f ingress.yaml

# Pick up freshly pushed :latest images.
kubectl rollout restart deployment/server deployment/studio -n "$NS"
for d in postgres minio server studio; do
	kubectl rollout status "deployment/$d" -n "$NS" --timeout=300s
done

echo 'Deployed: https://rk.dshs.app (studio) / https://rk.dshs.app/api (server)'
