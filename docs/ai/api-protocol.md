# HTTP and Socket.io Protocol Reference

[AI documentation index](../TOC_AI.md)

Exact payload schemas live in `packages/shared`; server DTOs and MCP schema-description tools are authoritative. This page describes route and protocol responsibilities. Route names below match the current NestJS controllers.

## REST API families

All routes use the `/api` prefix. Administrator routes require bearer authentication; login, health, media, and hosted-site delivery are public.

- `/api/auth/login` and `/api/auth/me`: issue and inspect the administrator JWT; `/api/health` is the public health check.
- `/api/themes`: list/create themes. `/:id` updates/deletes, `/:id/duplicate` deep-copies, `/:id/export` downloads a portable archive, and `/import` restores an archive as a new theme.
- `/api/themes/:themeId/assets`: CRUD heterogeneous assets. `/api/themes/:themeId/tags` manages organization labels.
- `/api/themes/:themeId/uploads` and `/api/files/url`: presigned single-file upload/download flows. `/api/themes/:themeId/imports/:kind` imports media ZIPs and `/imports/site` extracts a hosted-site ZIP.
- `/api/sessions`: create/list sessions and operate lifecycle, phase, timer, hints, one-off commands, logs, live runs, and ended-session summary.
- `/api/website-test`: create/list and control ephemeral website-test runs. The route family is singular.
- `/api/media/:assetId`: public stable response for file-backed image/file/video/BGM/SFX assets. A fileless image returns a generated ratio placeholder; other fileless kinds return 404.
- `/api/sites/:assetId/`: public hosted static-site tree; the trailing slash preserves relative asset resolution.

Upload flows usually request a presigned target and send bytes directly to S3. Playback URLs are short-lived. Hosted ZIP extraction is server mediated.

There is no `/api/players` REST family. Connected launcher discovery is streamed on the authenticated admin namespace, and test creation accepts a selected `playerId`; the server dispatches window requests over `/player`.

## Device namespace

Socket.io `/device` authenticates with device code, optional name, and client version. A code may match a production asset/lobby or a live test mapping.

Server-to-client events include `welcome`, session state, command, dialogue progress, hint show/error, and hint-code state. Client-to-server events include acknowledgment, trigger, progress, hint submit/step, Helper version, session resync, and asset-manifest request.

Command delivery is at-least-once. Client acknowledgment payload includes command ID and done/failed status. Client libraries remember seen and completed IDs to prevent duplicate side effects and repeat the prior acknowledgment.

## Admin and player namespaces

The authenticated admin namespace streams session state, device presence, playback/website state, logs, live runs, connected launchers, operator notifications, and website-test state/activity to Studio. Session controls themselves use the REST routes above.

The player launcher namespace advertises a stable player ID/name and receives requests to open stage windows for test sessions and website tests. Do not confuse launcher player IDs with player asset IDs.

## Helper envelopes

Helper-to-Player messages identify source `roomkit-helper` and include hello/claims, trigger, hint, timer, video completion/error, and awaited-message completion. Player-to-Helper messages identify `roomkit-player` and include mode, message, hint, timer/trigger results, subtitle, hint-code, and video play/stop.

Player validates shared Zod schemas and the source frame. Helper performs lightweight structural validation to keep its browser bundle small.

## Versioning and compatibility

Client and Helper report versions so Studio can warn about outdated devices. Unknown messages are ignored for forward compatibility. Invalid payloads are dropped and warned. A consumer should avoid depending on fields not exported by its installed package types.
