# Build context is the repo root: docker build -f docker/server.Dockerfile .
FROM node:22-slim AS build
# openssl is required by the Prisma engines
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

# Install with only manifests present so the layer caches across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile --filter server...

COPY packages/shared packages/shared
COPY packages/client packages/client
COPY apps/server apps/server
RUN pnpm --filter @roomkit/shared build \
	&& pnpm --filter server exec prisma generate \
	&& pnpm --filter server build

WORKDIR /repo/apps/server
ENV NODE_ENV=production
# Apply pending migrations before boot; prisma CLI comes from devDependencies.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main"]
