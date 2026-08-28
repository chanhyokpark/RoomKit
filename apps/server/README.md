# RoomKit Server

NestJS backend for RoomKit. It owns authentication, themes/tags/assets, uploads and hosted sites, sessions/timers/event execution, hints, post-game summaries, and the admin/device/player Socket.io namespaces.

The canonical contracts are documented in [architecture](../../docs/ai/architecture.md), [environment and deployment](../../docs/ai/environment.md), and [HTTP/Socket.io protocols](../../docs/ai/api-protocol.md). Exact payloads live in `packages/shared`.

## Local development

Run these from the repository root after `pnpm install`:

```sh
docker compose up -d
./init.sh
pnpm --filter server exec prisma migrate deploy
pnpm dev:server
```

Without the `app` profile, `docker compose up -d` starts PostgreSQL, MinIO, and the one-shot bucket creator only. `./init.sh` creates `apps/server/.env`, prompts for an administrator password, generates a JWT secret, and refuses to overwrite an existing file unless `--force` is passed. For non-interactive setup, pass the password as an argument.

The API starts at `http://localhost:3000/api` by default. Host development does not apply migrations automatically; rerun the Prisma command after schema changes. The Docker Server image does apply migrations before startup.

## Environment

Copying is handled by `./init.sh`; [`.env.example`](./.env.example) documents every value:

- `PORT`, `DATABASE_URL`
- `JWT_SECRET`, `ADMIN_ID`, `ADMIN_PASSWORD_HASH`
- `S3_ENDPOINT`, optional browser/device-facing `S3_PUBLIC_ENDPOINT`
- `S3_REGION`, `S3_BUCKET`, credentials, and `S3_FORCE_PATH_STYLE`
- optional externally reachable `PUBLIC_SERVER_URL` for hosted-site navigation

The public health check is `GET /api/health`. Login, health, `/api/media/:assetId`, and `/api/sites/:assetId/` are public; the remaining REST operations require an administrator bearer token.

## Checks

```sh
pnpm --filter server build
pnpm --filter server test
pnpm --filter server test:e2e
```

The end-to-end suite expects PostgreSQL and MinIO on the compose defaults, applies migrations to `roomkit_test`, and builds `@roomkit/client` first.
