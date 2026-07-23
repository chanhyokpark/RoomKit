# Build context is the repo root: docker build -f docker/studio.Dockerfile .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

# Install with only manifests present so the layer caches across source edits.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/studio/package.json apps/studio/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter studio...

COPY packages/shared packages/shared
COPY apps/studio apps/studio

# $env/static/public is inlined at build time, so the API origin is a build arg.
ARG PUBLIC_API_URL=http://localhost:3000
ENV PUBLIC_API_URL=$PUBLIC_API_URL
RUN pnpm --filter @roomkit/shared build && pnpm --filter studio build
# Production node_modules for adapter-node's externalized SSR dependencies.
RUN pnpm --filter studio deploy --prod --legacy /out

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/studio/build ./build
EXPOSE 3000
CMD ["node", "build"]
