# HTTP and Socket.io Protocol Reference

[AI documentation index](../TOC_AI.md)

Exact payload schemas live in `packages/shared`; server DTOs and MCP schema-description tools are authoritative. This page describes route and protocol responsibilities.

## REST API families

All administrator routes use `/api` and bearer authentication except public media/site delivery.

- `/api/auth/login`: issue administrator JWT.
- `/api/themes`: list/create themes; individual theme routes update, delete, duplicate, export, and import.
- `/api/themes/:themeId/assets`: CRUD heterogeneous assets; upload/import routes support files, media ZIPs, and hosted sites.
- `/api/tags`: theme-scoped organization labels.
- `/api/sessions`: create/list sessions and operate lifecycle, phase, timer, hints, manual commands, logs, runs, and summary.
- `/api/players`: connected launcher discovery and test-window dispatch.
- `/api/website-tests`: create and control ephemeral website test runs.
- `/api/media/:assetId`: public stable image/file asset response, including generated image placeholders.
- `/api/sites/:assetId/`: public hosted static-site tree.

Upload flows usually request a presigned target and send bytes directly to S3. Playback URLs are short-lived. Hosted ZIP extraction is server mediated.

## Device namespace

Socket.io `/device` authenticates with device code, optional name, and client version. A code may match a production asset/lobby or a live test mapping.

Server-to-client events include `welcome`, session state, command, dialogue progress, hint show/error, and hint-code state. Client-to-server events include acknowledgment, trigger, progress, hint submit/step, Helper version, session resync, and asset-manifest request.

Command delivery is at-least-once. Client acknowledgment payload includes command ID and done/failed status. Client libraries remember seen and completed IDs to prevent duplicate side effects and repeat the prior acknowledgment.

## Admin and player namespaces

The authenticated admin namespace streams session state, device presence, logs, and live run snapshots to Studio. It accepts session controls, manual triggers, timer/phase changes, reset, and run abortion.

The player launcher namespace advertises a stable player ID/name and receives requests to open stage windows for test sessions and website tests. Do not confuse launcher player IDs with player asset IDs.

## Helper envelopes

Helper-to-Player messages identify source `roomkit-helper` and include hello/claims, trigger, hint, timer, video completion/error, and awaited-message completion. Player-to-Helper messages identify `roomkit-player` and include mode, message, hint, timer/trigger results, subtitle, hint-code, and video play/stop.

Player validates shared Zod schemas and the source frame. Helper performs lightweight structural validation to keep its browser bundle small.

## Versioning and compatibility

Client and Helper report versions so Studio can warn about outdated devices. Unknown messages are ignored for forward compatibility. Invalid payloads are dropped and warned. A consumer should avoid depending on fields not exported by its installed package types.
