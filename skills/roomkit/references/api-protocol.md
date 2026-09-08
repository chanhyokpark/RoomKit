# HTTP and Socket.io Protocol Reference

[RoomKit skill](../SKILL.md)

Exact payload schemas live in `packages/shared`; server DTOs and `rk describe commands` / `rk describe asset <kind>` are authoritative. This page describes route and protocol responsibilities. Route names below match the current NestJS controllers.

## REST API families

All routes use the `/api` prefix. Administrator routes require bearer authentication; login, health, media, and hosted-site delivery are public.

- `/api/auth/login` and `/api/auth/me`: issue and inspect the administrator JWT; `/api/health` is the public health check.
- `/api/themes`: list/create themes. `/:id` updates/deletes, `/:id/duplicate` deep-copies, `/:id/export` downloads a portable archive, and `/import` restores an archive as a new theme.
- `/api/themes/:themeId/assets`: CRUD heterogeneous assets. `/api/themes/:themeId/tags` manages organization labels.
- `/api/themes/:themeId/uploads` and `/api/files/url`: presigned single-file upload/download flows. `/api/themes/:themeId/imports/:kind` imports media ZIPs and `/imports/site` extracts a hosted-site ZIP.
- `/api/sessions`: create/list sessions and operate lifecycle, phase, timer, hints, one-off commands, logs, live runs, and ended-session summary. Test-session creation accepts a launcher `playerId`, an optional `deviceIds` subset, and `urlOverrides` substituting website asset URLs; responses include the stored `urlOverrides` record. `POST /api/sessions/:id/devices/:deviceId/test-callback` runs a Helper-registered test callback (test sessions only; 400 for production).
- `/api/media/:assetId`: public stable response for file-backed image/file/video/BGM/SFX assets. A fileless image returns a generated ratio placeholder; other fileless kinds return 404.
- `/api/sites/:assetId/`: public hosted static-site tree; the trailing slash preserves relative asset resolution.

Upload flows usually request a presigned target and send bytes directly to S3. Playback URLs are short-lived. Hosted ZIP extraction is server mediated.

There is no `/api/players` REST family. Connected launcher discovery is streamed on the authenticated admin namespace, and test-session creation accepts a selected `playerId`; the server dispatches window requests over `/player`.

## Device namespace

Socket.io `/device` authenticates with device code, optional name, and client version. A code may match a production asset/lobby or a live test mapping.

Server-to-client events include `welcome`, session state, command, dialogue progress, hint show/error, hint-code state, and `call:state` (voice call control, see below). Client-to-server events include acknowledgment, trigger, progress, hint submit/step, Helper version, session resync, asset-manifest request, and the call events `call:request` (ack), `call:cancel`, `call:status`.

Command delivery is at-least-once. Client acknowledgment payload includes command ID and done/failed status. Client libraries remember seen and completed IDs to prevent duplicate side effects and repeat the prior acknowledgment.

Wire commands: `play` (bgm/sfx/dialogue/video; bgm and video may carry `offsetMs` on reconnect replays), `stop`, `bgmVolume`, `navigate` (null `websiteId`/`url` = unload the website), `reset`, `message`, `state` (`state` set = durable display state, null = default), `hintCode`, `testCallback`. On (re)connect the server replays the device's current website, state, hint code, looping BGM and in-flight video (see [reconnect replay](./system-model.md#reconnect-replay)); replays of acked wires use fresh ids and must be applied idempotently.

## Admin and player namespaces

The authenticated admin namespace streams session state, device presence, playback/website/state tracking (`session:media` carries `playing`, `websites` and `states`), logs, live runs, connected launchers, operator notifications, and voice-call state (`call:state`). Its consumers are Studio and the Player debug window. Device status includes the Helper-registered message, state and test-callback names (`helperMessages`, `helperStates`, `helperTestCallbacks`) relayed from the loaded page. Session controls themselves use the REST routes above; voice calls are the one exception (below), because a call belongs to the admin socket that started it.

## Voice calls

An operator and a hintphone can talk over an audio-only PeerJS call. The server (`CallService`) keeps one call per session in memory and only sequences the signaling; media flows peer to peer through the PeerJS server mounted on the RoomKit server at `/peerjs` (websocket at `/peerjs/peerjs` — proxies must forward it like `/socket.io`). Calls require a production session and a device whose Player window has a Helper website loaded (`helper:info` seen) on a client ≥ 0.5.0; anything else is refused (`test_session`, `no_helper`, `device_outdated`, `device_offline`, `session_not_live`).

- Admin socket events, each answered with a socket.io ack `CallActionAck` (`{ ok: true, call }` or `{ ok: false, reason }`): `call:config` → `{ iceServers }` (from `CALL_ICE_SERVERS`), `call:start { sessionId, deviceId, peerId }`, `call:accept { sessionId, callId, peerId }`, `call:decline { sessionId, callId }`, `call:end { sessionId }`. The operator opens its own PeerJS peer first and passes its id; the device then calls that peer. `call:end` is owner-only (`not_owner`); a second call while one exists is `busy`.
- Admin broadcast `call:state { sessionId, call | null, endReason? }` on every change and in the connect dump. `call.adminSocketId` identifies the owner; its disconnect ends the call (`admin_disconnected`).
- Device events: `call:request` (ack `{ ok, callId | reason }`) puts the session's call in `requested` until an operator accepts or declines, or the device sends `call:cancel { callId }`. On accept/start the device receives `call:state { status: 'connecting', callId, adminPeerId, devicePeerId, iceServers }`, registers as `devicePeerId`, calls `adminPeerId` with its microphone and reports `call:status { callId, status: 'connected' | 'failed', reason? }`. `call:state { status: 'ended', callId, reason }` tears it down. A call stuck in `connecting` for 30 s ends with `timeout`; a device going offline ends it with `device_offline`; session end with `session_ended`.
- Every transition is logged with kind `call`.

The player launcher namespace advertises a stable player ID/name and receives requests to open stage windows for test sessions. Do not confuse launcher player IDs with player asset IDs.

## Helper envelopes

Helper-to-Player messages identify source `roomkit-helper` and include hello/claims, trigger, hint, timer, video completion/error, awaited-message completion, `test:callback:done`, haptics, and the call envelopes `call:request` / `call:cancel`. Hello also carries the page's registered message-handler, state and test-callback names, which Player relays server-side via the extended `helper:info`. Player-to-Helper messages identify `roomkit-player` and include mode, state (re-posted on every hello; null = default), `call:state` (`idle | requesting | connecting | connected`, also re-posted on every hello), `call:result`, message, hint, timer/trigger results, subtitle, hint-code, video play/stop (with `offsetMs` on replays), haptics results, and `test:callback` requests driven by the `testCallback` wire command.

Player validates shared Zod schemas and the source frame. Helper performs lightweight structural validation to keep its browser bundle small.

## Versioning and compatibility

Client and Helper report versions so Studio can warn about outdated devices. Unknown messages are ignored for forward compatibility. Invalid payloads are dropped and warned. A consumer should avoid depending on fields not exported by its installed package types.
