# Environment and Deployment

[AI documentation index](../TOC_AI.md)

## Required toolchain

- Node.js 22 or newer
- pnpm 10.28.2, pinned by the root `packageManager`
- Docker and Docker Compose for PostgreSQL and S3-compatible development storage
- Rust 1.77.2 or newer only for Tauri Player builds

Install workspace dependencies with `pnpm install`. Build all packages with `pnpm build`; package ordering is resolved by pnpm, but changes to shared schemas should be followed by an explicit shared build when running individual applications.

## Development modes

The quickest complete environment is:

```sh
pnpm infra
```

It starts the application Docker profile. Defaults are Server `http://localhost:3000`, Studio `http://localhost:5173`, administrator `admin/roomkit`, PostgreSQL host port `5433`, MinIO API `9000`, and console `9001`.

For host development, start only infrastructure and then applications:

```sh
docker compose up postgres minio
pnpm dev:server
pnpm --filter studio dev
pnpm dev:player
```

The server applies Prisma migrations and uses `/api` as the REST prefix. Player stores its server URL, stable launcher ID/name, device configuration, and cache under the platform application-data directory.

## Library installation from GitHub

RoomKit libraries are private package manifests installed directly from git. pnpm 10 blocks dependency build scripts unless allowed. A consumer must list the package in `onlyBuiltDependencies`:

```yaml
onlyBuiltDependencies:
  - "@roomkit/client"
  - "@roomkit/helper"
  - "@roomkit/hintphone-react"
```

Then install the required package:

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper"
```

Pin production consumers to a tag or commit using `#<ref>&path:packages/helper`. Package `prepare` scripts build distributable ESM/CJS/types during installation.

## Website builds

Player website assets must be static. For server ZIP hosting, place `index.html` at the ZIP root and use relative build assets (`base: './'` in Vite). A single wrapping directory is stripped, but relying on that behavior is discouraged. External sites may use any host reachable from Player.

Use HTTPS consistently in production. A secure page cannot freely load insecure resources. For delegated video, always use the URL supplied by Helper; cached bytes may be converted to a same-origin `blob:` URL to avoid mixed-content restrictions.

## Production deployment

The repository contains Docker and Kubernetes examples, not a hosted control plane. A production deployment needs:

- PostgreSQL with durable backups;
- S3-compatible object storage and a configured bucket;
- Server and Studio behind TLS;
- WebSocket upgrade forwarding for Socket.io;
- a private administrator password and restricted Studio access;
- a server URL resolvable and reachable from every Player/custom device;
- storage CORS/presigned URL behavior compatible with Player media downloads.

Do not expose PostgreSQL or MinIO administration ports publicly. The Kubernetes manifests under `k8s/` show the expected services, ingress, and build/deploy flow.
