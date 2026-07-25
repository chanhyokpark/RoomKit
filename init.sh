#!/usr/bin/env bash
# Initialize apps/server/.env from .env.example: generates a random
# JWT_SECRET and hashes the admin password with bcryptjs.
#
# Usage:
#   ./init.sh                # prompts for the admin password
#   ./init.sh mypassword     # non-interactive
#   ./init.sh --force [pw]   # overwrite an existing .env
set -euo pipefail
cd "$(dirname "$0")/apps/server"

force=0
if [[ "${1:-}" == "--force" ]]; then
	force=1
	shift
fi

if [[ -f .env && $force -eq 0 ]]; then
	echo "apps/server/.env already exists — rerun with --force to overwrite." >&2
	exit 1
fi

if [[ ! -d node_modules/bcryptjs ]]; then
	echo "bcryptjs not found — run 'pnpm install' first." >&2
	exit 1
fi

password="${1:-}"
if [[ -z "$password" ]]; then
	read -rsp 'Admin password: ' password
	echo
	read -rsp 'Confirm password: ' confirm
	echo
	if [[ "$password" != "$confirm" ]]; then
		echo 'Passwords do not match.' >&2
		exit 1
	fi
fi
if [[ -z "$password" ]]; then
	echo 'Password must not be empty.' >&2
	exit 1
fi

jwt_secret=$(openssl rand -hex 32)
hash=$(RK_PASSWORD="$password" node -e \
	'console.log(require("bcryptjs").hashSync(process.env.RK_PASSWORD, 10))')

while IFS= read -r line; do
	case "$line" in
	JWT_SECRET=*) printf 'JWT_SECRET=%s\n' "$jwt_secret" ;;
	ADMIN_PASSWORD_HASH=*) printf 'ADMIN_PASSWORD_HASH=%s\n' "$hash" ;;
	*) printf '%s\n' "$line" ;;
	esac
done <.env.example >.env

echo 'Wrote apps/server/.env (admin id: admin).'
