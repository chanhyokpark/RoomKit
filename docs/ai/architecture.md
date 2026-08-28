# Architecture and Design Decisions

[AI documentation index](../TOC_AI.md)

## Components

| Component              | Responsibility                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `apps/server`          | NestJS REST API, Socket.io gateways, sequence runtime, timer, eval sandbox, media/site delivery, and persistence orchestration. |
| `apps/studio`          | SvelteKit authoring and operation SPA. It uses REST for CRUD and admin sockets for live session state.                          |
| `apps/player`          | Tauri launcher, stage windows, and a test-session debug window. It uses `@roomkit/client`, owns media playback, embeds websites, and bridges Helper messages. |
| `apps/mcp`             | Stdio MCP server that exposes Studio operations to AI agents through REST and virtual device sockets.                           |
| `packages/shared`      | Zod schemas and shared protocol types; the source of truth for asset, command, helper, and wire shapes.                         |
| `packages/client`      | Direct Socket.io device client with validation, command dedupe, acknowledgment, and reconnect behavior.                         |
| `packages/helper`      | Small browser bridge for websites inside Player; communicates only with the parent frame.                                       |
| `packages/hintphone-*` | Transport-independent hint state/controller plus React and Svelte UI bindings.                                                  |

PostgreSQL stores durable metadata and session state. S3-compatible storage holds uploaded files and hosted-site trees. The server issues presigned URLs for playback/cache delivery and exposes stable public routes for file-backed image/file/video/BGM/SFX assets and hosted sites.

## End-to-end data flow

1. Studio writes theme and asset metadata through `/api` REST routes.
2. The operation UI creates and starts a session.
3. A device authenticates to Socket.io `/device` with a production or test code and receives `welcome` plus session state.
4. A trigger causes the server runtime to select eligible events and start sequence runs.
5. Commands are resolved to wire payloads with media URLs and routed to devices.
6. Devices acknowledge automatic commands immediately and owner-handled commands after the actual work finishes.
7. Runtime state and logs stream to `/admin` clients and remain queryable after the session.

## Settled decisions

- One server manages many themes; one non-ended production session is allowed per theme.
- Multiple physical rooms using the same design use duplicated themes.
- Authentication is a single administrator account with bearer JWT for Studio/MCP operations.
- External and server-hosted ZIP websites are supported.
- Player-embedded websites use Helper; standalone devices use Client.
- Hints are code based and reveal ordered steps, with an optional explicit answer.
- Eval runs server-side for access to session variables and runtime actions.
- Ad-hoc website testing uses real test sessions with per-session website URL overrides; the former in-memory website-test runtime was removed. Player's launcher creates these sessions and drives them from a debug window.
- Player-created test sessions auto-end on the server after all devices disconnect (60-second grace) or when no device ever connects within ten minutes.
- Subtitles are associated with dialogue audio lines, not time-coded within one line.
- Team turnover is a new session plus bulk device reset.

## Theme duplication and storage

Theme duplication deep-copies all asset metadata and remaps cross-asset references: player device IDs, event phase IDs, and sequence asset references. Device/hint codes copy verbatim because uniqueness is theme scoped. Dialogue line IDs remain stable so line-cue anchors survive. File keys are shared with the source rather than copying bytes.

Bulk ZIP media import always creates assets. Dialogue files ending in `_N` are grouped and ordered into one dialogue. Junk entries and unsupported files are skipped and reported.

Hosted websites are extracted to an immutable storage prefix. Re-upload extracts to a new prefix and then swaps metadata, avoiding partially updated sites.

Theme export writes a portable ZIP containing `manifest.json` plus every referenced media, hint image, and hosted-site object. Import always creates a new theme, mints fresh database IDs and storage keys, and remaps internal references. Missing direct file/image keys become null references (a placeholder only where that asset kind supports one); a missing hosted-site object remains a 404 within the newly assigned site prefix. Unlike duplication, imported bytes belong to the new theme.

## Trust and security boundaries

- Admin-authored eval, subtitle HTML, hint HTML, CSS, and free-form params are trusted content. They are not a safe boundary against malicious authors.
- Helper uses `postMessage` because it runs inside Player's iframe. Player validates message schemas and checks the iframe source; Helper targets `*` because it cannot know the Tauri origin.
- Hosted sites and `/api/media/{assetId}` are public. Asset UUIDs reduce discoverability but are not authorization.
- Device codes grant device-level session attachment. Treat test and production codes as secrets appropriate to a room network, not administrator credentials.
- MCP retains credentials in memory for automatic re-login. Anyone controlling that AI session effectively has Studio administrator access.
