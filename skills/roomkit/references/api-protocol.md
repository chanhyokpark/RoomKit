# HTTP and Socket.io Protocol Reference

[RoomKit skill](../SKILL.md)

Exact payload schemas live in `packages/shared`; server DTOs and `rk describe commands` / `rk describe asset <kind>` are authoritative. This page describes route and protocol responsibilities. Route names below match the current NestJS controllers.

## REST API families

All routes use the `/api` prefix. Administrator routes require bearer authentication; login, health, media, and hosted-site delivery are public.

- `/api/auth/login` and `/api/auth/me`: issue and inspect the administrator JWT; `/api/health` is the public health check.
- `/api/themes`: list/create themes. `/:id` updates/deletes, `/:id/duplicate` deep-copies, `/:id/export` downloads a portable archive, and `/import` restores an archive as a new theme.
- `/api/themes/:themeId/assets`: CRUD heterogeneous assets. `/api/themes/:themeId/tags` manages organization labels.
- `/api/themes/:themeId/uploads` and `/api/files/url`: presigned single-file upload/download flows. `/api/themes/:themeId/imports/:kind` imports media ZIPs and `/imports/site` extracts a hosted-site ZIP.
- `/api/sessions`: create/list sessions and operate lifecycle, phase, timer, hints, one-off commands, logs, live runs, and ended-session summary. Test-session creation accepts a launcher `playerId`, an optional `deviceIds` subset, and `urlOverrides` substituting website asset URLs; responses include the stored `urlOverrides` record. `POST /api/sessions/:id/devices/:deviceId/test-callback` runs a Helper-registered test callback (test sessions only; 400 for production). `GET /api/sessions/:id/devices` returns live per-device diagnostics (`SessionDevicesResponse`: `online`, `windows`, client/Helper versions and registrations, shown `website`/`state`, `screenshotAt`, `ready`) for any session. `GET /api/sessions/:id/devices/:deviceId/logs` returns `DeviceLogBatch` `{sessionId, deviceId, lines:[{seq, at, level, message}]}` — the device's uploaded Player log lines, oldest first, from an in-memory ring buffer of 1000 lines per device (kept while the device is offline, cleared when the session ends; any mode; no query parameters — filter client-side by `seq`). Website console lines forwarded by Helper 0.10.0+ are prefixed `site: `.
- Manual trigger: `POST /api/sessions/:id/trigger` (`ManualTriggerInput`) takes exactly one of `eventId` (run that event: any event, phase guard bypassed) or `trigger` (a device trigger name: every listening event runs as if a device emitted it, phase guard applies), plus optional `payload` (JSON, `{{payload.x}}` in the sequence) and `force` (default false; bypasses only `once`). It answers **200** with `ManualTriggerResult` `{eventId?, trigger?, events:[{eventId, eventName, started, runId?, reason?}]}` — `events` is empty when nothing listens to `trigger`; a rejected `eventId` answers 4xx with the reason. The session must be started and not ended.
- Runs: `GET /api/sessions/:id/runs` → `SessionRuns`; `POST /api/sessions/:id/runs/:runId/abort` (204) cancels a run; `POST /api/sessions/:id/runs/:runId/skip` (204) skips its current entry — a `wait` ends now, a waited playback/message stops being awaited — and the sequence continues.
- `/api/media/:assetId`: public stable response for file-backed image/file/video/BGM/SFX assets. A fileless image returns a generated ratio placeholder; other fileless kinds return 404.
- `/api/sites/:assetId/`: public hosted static-site tree; the trailing slash preserves relative asset resolution.

Upload flows usually request a presigned target and send bytes directly to S3. Playback URLs are short-lived. Hosted ZIP extraction is server mediated.

There is no `/api/players` REST family. Connected launcher discovery is streamed on the authenticated admin namespace, and test-session creation accepts a selected `playerId`; the server dispatches window requests over `/player`.

## Device namespace

`POST /api/sessions/:id/devices/:deviceId/eval` (admin JWT, any live session — test or production) takes `{code,timeoutMs?,screenshot?,screenshotFormat?:"png"|"jpeg"}` and returns HTTP 200 with `{requestId,result:{ok,value?|error?},screenshot?,screenshotError?}`. Invalid requests and ended sessions are rejected with 400 (the Player answers `not_live` if it sees the session as over); offline, duplicate windows or a busy target return 409. Production needs Player 0.16.0+ (client 0.8.0+) and Helper 0.10.0+; older ones answer `test_only` outside test sessions. See [Website JS evaluation](./website-eval.md).

This sends `device:eval` to exactly one `/device` socket with an acknowledgement carrying the correlated result. It is separate from authored wire commands: no replay or automatic retry. Player relays `test:eval` to the iframe and receives `test:eval:result`; Helper hello advertises `testEval:true` (the envelope names keep the historical `test:` prefix). Both sides check the source window; Player also checks the site's origin. Helper 0.10.0+ no longer gates eval by session mode; the authenticated server route and the Player's live-session check do.

Helper also sends `test:eval:invalidate` on pagehide/disposal so a capture still in flight cannot be returned as the previous document's result.

`POST /api/sessions/:id/devices/:deviceId/window` (same auth and refusals; any live session) takes `{focus?,screenshot?,screenshotFormat?,timeoutMs?}` and sends `device:window` to that one socket; the Player shows/unminimizes/focuses its stage window, waits until the document is visible, and answers `{requestId,result:{ok,value:{visible,focused,platform}|error},screenshot?,screenshotError?}`. It needs no website, so it also captures the idle screen or a playing video.

`POST /api/sessions/:id/devices/:deviceId/reload` (`{waitReady?,timeoutMs?}`) re-sends the website the runtime last navigated the device to as a `navigate` wire with `force:true` (the Player re-creates its iframe) and waits for the load ack; with `waitReady` it also waits for the next `helper:info` of that device, armed before the navigate so a fast hello is not missed. Reply: `{websiteId,url,loaded,status,helperReady?,helperVersion?,helperTestCallbacks?}`. 400 when the device shows no website or the session has ended, 409 when offline/duplicated/busy. Any `navigate` wire clears the device's stored Helper info until the new page says hello, so `GET …/devices` reports `ready:false` in between.

Socket.io `/device` authenticates with device code, optional name, and client version. A code may match a production asset/lobby or a live test mapping.

Server-to-client events include `welcome`, session state, command, dialogue progress, hint show/error, hint-code state, and `call:state` (voice call control, see below). Client-to-server events include acknowledgment, trigger, progress, hint submit/step, Helper version, session resync, asset-manifest request, `device:logs` (a batch of up to 200 log lines of the player window — its own console plus the website's forwarded `site: ` lines — buffered per device, relayed to `/admin` with a monotonic `seq`, and served by `GET …/devices/:deviceId/logs`), and the call events `call:request` (ack), `call:cancel`, `call:status`.

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

Helper-to-Player messages identify source `roomkit-helper` and include hello/claims, trigger, hint, timer, video completion/error, awaited-message completion, `test:callback:done`, `test:eval:result`/`test:eval:invalidate`, `log` (`{at, level: debug|info|warn|error, message ≤4000}` — one forwarded console line or uncaught error, Helper 0.10.0+ `forwardConsole`; Player 0.16.0+ prefixes it `site: ` and adds it to the device logs), haptics, and the call envelopes `call:request` / `call:cancel`. Hello also carries the page's registered message-handler, state and test-callback names, which Player relays server-side via the extended `helper:info`. Player-to-Helper messages identify `roomkit-player` and include mode (`{mode, forwardLogs?}`; `forwardLogs: true` = this Player collects `log` envelopes, so the Helper starts sending them — absent on Players before 0.16.0), state (re-posted on every hello; null = default), `call:state` (`idle | requesting | connecting | connected`, also re-posted on every hello), `call:result`, message, hint, timer/trigger results, subtitle, hint-code, video play/stop (with `offsetMs` on replays), haptics results, and `test:callback` requests driven by the `testCallback` wire command.

Player validates shared Zod schemas and the source frame. Helper performs lightweight structural validation to keep its browser bundle small.

## Versioning and compatibility

Client and Helper report versions so Studio can warn about outdated devices. Unknown messages are ignored for forward compatibility. Invalid payloads are dropped and warned. A consumer should avoid depending on fields not exported by its installed package types.
