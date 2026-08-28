# RoomKit Studio

SvelteKit web application for theme authoring, asset/tag and archive management, event-sequence editing, and live session operation.

User workflows start at the [RoomKit documentation index](../../docs/TOC.md). Implementation-level behavior is covered by [architecture](../../docs/ai/architecture.md), [theme authoring](../../docs/ai/authoring.md), and [sessions/testing](../../docs/ai/sessions-testing.md).

## Local development

Start RoomKit Server first, then run from the repository root:

```sh
pnpm --filter @roomkit/shared build
cp -n apps/studio/.env.example apps/studio/.env
pnpm --filter studio dev
```

Studio opens at `http://localhost:5173`. `PUBLIC_API_URL` must be the RoomKit Server origin as reachable from the operator's browser, without `/api` or a trailing slash.

## Public environment values

- `PUBLIC_API_URL` is imported statically and therefore baked into production client bundles.
- `PUBLIC_EXPECTED_PLAYER_VERSION`, `PUBLIC_EXPECTED_CLIENT_VERSION`, and `PUBLIC_EXPECTED_HELPER_VERSION` are optional runtime overrides for the minimums shown in the operation warning banner.

See [`.env.example`](./.env.example) for defaults. The Docker and Kubernetes builds pass `PUBLIC_API_URL` as a build argument.

## Checks

```sh
pnpm --filter studio check
pnpm --filter studio lint
pnpm --filter studio build
```

`lint` checks formatting and ESLint without rewriting files. `build` produces the adapter-node application used by the Studio container.
