# RoomKit — System Introduction

RoomKit is a toolkit for building, managing, and running escape room games. A creator authors the game (media, devices, puzzles-as-events) in a web studio, and an operator runs live sessions from the same studio while in-room devices (screens, speakers, kiosks, sensors) execute commands pushed from the server in real time.

This document explains the system as built: its components, core terms, data model, and runtime behavior. For the UI walkthrough, see [MANUAL.md](./MANUAL.md). For the original design decisions, see [SPEC.md](./SPEC.md).

## 1. Architecture Overview

```
                 ┌──────────────────────────────────────────────┐
                 │              apps/server (NestJS)            │
   REST /api     │  auth · themes · assets · sessions · logs    │
  ┌─────────────▶│  runtime (sequence engine, timer, eval)      │
  │              │  gateway (Socket.io /device, /admin)         │
  │              │  storage (S3 presign, zip import, sites)     │
  │              └──────┬───────────────┬───────────────────────┘
  │                     │               │
  │              Postgres (Prisma)   S3 / MinIO (media files)
  │
  │   Socket.io /admin ▲          Socket.io /device ▲
  │                    │                            │
┌─┴────────────────────┴─┐      ┌───────────────────┴──────────────────┐
│  apps/studio           │      │  apps/player (Tauri)                 │
│  SvelteKit SPA         │      │  launcher + stage windows            │
│  authoring + operation │      │  built on @roomkit/client            │
└────────────────────────┘      │  ┌────────────────────────────────┐  │
                                │  │ website iframe                 │  │
   any custom device ───────────┤  │ (@roomkit/helper, postMessage) │  │
   (@roomkit/client)            │  └────────────────────────────────┘  │
                                └──────────────────────────────────────┘
```

One server manages **multiple themes** (games). All state authority lives on the server: devices are thin — they play media and report triggers; all game logic (sequences, timers, variables, branching) executes server-side.

### Components

| Component           | Path              | What it is                                                                                                                                                                            |
| ------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server**          | `apps/server`     | NestJS app. REST API (under `/api`), two Socket.io namespaces, the sequence runtime, Postgres via Prisma, S3-compatible object storage.                                               |
| **Studio**          | `apps/studio`     | SvelteKit single-page admin app (Korean UI). Three workspaces per theme: asset management, editor (events/sequences), operation (live sessions).                                      |
| **Player**          | `apps/player`     | Tauri desktop app for in-room devices. A launcher window opens one fullscreen _stage window_ per configured device; handles playback, subtitles, caching, kiosk lock.                 |
| **@roomkit/client** | `packages/client` | JS library — the way any device connects to the server (websocket). Used by the player and by standalone websites/custom hardware.                                                    |
| **@roomkit/helper** | `packages/helper` | Tiny (~1.5 KB) `<script>` embed for websites shown **inside the player's iframe**. No socket of its own — talks to the player via postMessage, riding the player's device connection. |
| **@roomkit/shared** | `packages/shared` | Zod schemas and TypeScript types shared by everything: asset data schemas, the command set, the wire protocol, socket event maps.                                                     |

### Tech stack

- TypeScript everywhere; pnpm monorepo (Node ≥ 22, pnpm 10).
- Server: NestJS 11, Prisma (PostgreSQL), Socket.io 4, AWS S3 SDK (works with MinIO), zod validation at every boundary.
- Studio: SvelteKit (Svelte 5 runes), CSR-only, shadcn-svelte + Tailwind v4, socket.io-client.
- Player: Tauri v2 (Rust shell), Svelte frontend, local media cache in Rust.
- Infra for development: `docker-compose.yml` provides Postgres (host port **5433**) and MinIO (**9000** API / **9001** console). The server itself runs on port **3000**; studio dev on **5173**; player dev on **5175**.

## 2. Glossary

| Term                             | Meaning                                                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Theme**                        | One escape room game. Owns all of its assets, tags, and sessions. Has an optional time limit (countdown). Themes can be deep-duplicated (for multiple rooms of the same game, or season backups).                                                          |
| **Asset**                        | Any authored object in a theme. Everything — including phases and events — is stored as an `Asset` row with a `kind` and kind-specific JSON `data` (zod-validated). 11 kinds, listed below.                                                                |
| **Device**                       | An asset representing a physical endpoint in the room (a screen, speaker, kiosk, sensor board). Has a `code` used for production registration and an optional _hint device_ flag.                                                                          |
| **Player (asset)**               | A logical _output group_: a speaker device + a screen device + subtitle CSS. Dialogue/video playback commands target a player, not a raw device, so voice goes to the speaker and subtitles/video to the screen. Not to be confused with the player _app_. |
| **BGM / SFX / Video / Dialogue** | Media assets. Dialogue is a sequence of ordered voice lines, each with an optional HTML subtitle.                                                                                                                                                          |
| **Placeholder asset**            | A media asset (or dialogue line) saved without a file. It carries a `durationMs`; clients show a placeholder overlay and simulate playback for that long. Lets you author and test sequences before real media exists.                                     |
| **Hint**                         | An asset with a `code` (4-digit, auto-generated, editable) and an ordered list of steps (HTML text + optional image). Players type the code on the hint device to reveal steps one at a time.                                                              |
| **Website**                      | An asset pointing at web content: `external` (a URL) or `hosted` (a zip uploaded and served by the server at `/api/sites/{assetId}/`). Shown on a device via the _navigate_ command.                                                                       |
| **Message**                      | A payload **schema** (typed fields) for sending structured data to a device. The asset defines the shape; concrete values are entered in the editor when authoring a _send message_ command. Used to update website status without navigating.             |
| **Tag**                          | A colored label for organizing assets (filtering in the studio). No runtime meaning.                                                                                                                                                                       |
| **Phase**                        | A game progression stage (ordered). A session is always in exactly one phase. Events belong to a phase or are _common_.                                                                                                                                    |
| **Event**                        | The unit of game logic. Has a trigger (device / manual / system), flags (`manualTriggerable`, `allowReentry`), and a **sequence** of commands. All logic starts from an event.                                                                             |
| **Sequence**                     | An ordered list of commands stored on an event, executed by the server runtime.                                                                                                                                                                            |
| **Command**                      | One step in a sequence. 17 types — see §4.                                                                                                                                                                                                                 |
| **Session**                      | One live run of a theme. `mode: production                                                                                                                                                                                                                 | test`, `state: created → running ⇄ paused → ended`. Holds the current phase, session variables, and the countdown timer. |
| **Production session**           | The real game. At most **one non-ended production session per theme**. Physical devices registered by their device code attach to it automatically.                                                                                                        |
| **Test session**                 | A rehearsal run. Many can coexist per theme. The operator enters a one-off **test code** per device at creation; testers connect with those codes (player in test mode, or any `@roomkit/client` consumer). Codes are freed when the session ends.         |
| **Device code vs test code**     | A device code is a permanent per-device credential authored on the device asset (production). A test code is per-session and per-device, entered by the operator (test). Test codes are checked first at connect and shadow production codes.              |
| **Trigger**                      | What starts an event: a **device trigger** (a device reports an event name), a **manual trigger** (operator presses a button in the operation UI), or a **system trigger** (`session:start`, `phase:enter`, `phase:leave`, `timer:expired`).               |
| **Hint device**                  | A device asset flagged `isHintDevice`. It is allowed to submit hint codes and receives operator hint pushes. RoomKit ships no hint UI — hint screens are built with `@roomkit/client` or the helper.                                                       |

## 3. Data Model

PostgreSQL via Prisma (`apps/server/prisma/schema.prisma`):

- **Theme** — `id, name, timeLimitMs?` (null = no countdown).
- **Asset** — `id, themeId, kind, name, description, code?, data(Json), tags[]`. `kind` ∈ `device, bgm, dialogue, sfx, video, hint, player, website, message, phase, event`. `code` is used only by device (user-set) and hint (auto 4-digit); unique per `(themeId, kind)`. `data` is validated per kind by the zod schemas in `@roomkit/shared` (`assets.ts`).
- **Tag** — `id, themeId, name, color`; many-to-many with assets.
- **Session** — `id, themeId, mode, state, phaseId?, vars(Json), startedAt, endedAt?, timerEndsAt?, timerRemainingMs?`. A partial unique index enforces one live production session per theme.
- **SessionDeviceCode** — operator-entered test codes (`sessionId, deviceId, code`), globally unique, deleted on session end.
- **SessionLog** — append-only log (`level, kind, message, data`) per session; the operation UI streams and pages it.

File-backed assets store an **S3 key** (`fileKey`). Upload keys are immutable (a new upload gets a new key), which is what makes the player's presence-based cache correct.

## 4. Events, Sequences, and Commands

All game logic is expressed as events whose sequences run **on the server** (`apps/server/src/runtime`).

**Phase guard** — only events belonging to the session's current phase (or common events, `phaseId: null`) may run; out-of-phase triggers are ignored and logged. **Re-entry** of an already-running event is blocked unless `allowReentry` is set. Sequences run **in parallel** within a session (e.g. an event can fire while BGM plays).

The 17 command types (`@roomkit/shared` `commands.ts`):

| Group    | Commands                                                                                                                     | Notes                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Playback | `playDialogue`, `stopDialogue`, `playSfx`, `stopSfx`, `playVideo`, `stopVideo`, `playBgm`, `stopBgm`                         | Play targets a **player** asset. `playDialogue`/`playVideo` support `waitUntilEnd`; `playBgm` supports `loop`. |
| Device   | `resetDevice`, `resetAllDevices`, `navigate` (send a device to a website), `sendMessage` (schema-driven payload to a device) | `navigate` waits for the device's website-changed `ack` (player: iframe loaded) before the sequence continues. |
| Flow     | `wait` (server timer, pauses with the session), `switchPhase`, `callEvent` (subroutine, depth limit 8), `eval`               |                                                                                                                |
| Timer    | `adjustTimer` (±ms, or pause/resume the countdown)                                                                           |                                                                                                                |

**Execution details:**

- Device-directed commands are resolved into coarse **wire commands** (`wire.ts`): `play`, `stop`, `navigate`, `reset`, `message`. Play commands carry presigned media URLs (~6 h expiry) — or `url: null` + `durationMs` for placeholders.
- **waitUntilEnd** — the sequence waits for the device's `ack`. Offline device → logged, continue immediately. Ack timeout is 15 minutes. Looping BGM acks on start; other plays ack on finish. `navigate` always waits: the device acks once the website has actually changed (player: iframe `load`).
- **Dialogue relay** — the speaker device plays lines and reports per-line `progress`; the server relays it to the screen device, which renders subtitles in sync.
- **Delivery** — at-least-once with `commandId` idempotency; unacked commands are redelivered on device reconnect and deduped client-side.
- **Eval sandbox** — `node:vm` with a 1 s timeout (a hang guard, not a security boundary — eval code is trusted admin input). Injected API: `ctx.vars` (session variables), `ctx.phase` (current phase name), `ctx.trigger(name)`, `ctx.log(msg)`. Returning `false` stops the sequence, which is how branching/guards work without a dedicated branch command.
- **Phase switch** — `phase:leave` hooks run to completion in the old phase, then the phase changes and `phase:enter` hooks fire.

## 5. Session Lifecycle and Timer

Sessions are created **idle** (`created`) and started explicitly from the operation dashboard. Devices may connect to an idle session (or wait in the server's _lobby_ for a production session to exist), so the operator can verify online status before starting. On start, the countdown arms and `session:start` system events fire.

- **Pause** freezes the timer, `wait` commands, and sequence progress; **resume** continues them.
- **End** aborts running sequences, resolves pending acks, frees test codes, and disconnects the session's devices (they fall back to the lobby / retry loop, ready for the next session).
- The **countdown timer** comes from the theme's time limit (nullable). Expiry fires the `timer:expired` system trigger — wire it to an event (e.g. a game-over dialogue) yourself. Remaining time is broadcast in `session:state`, so the operation UI, the player's test overlay, and any custom screen can render it. It is adjustable from sequences (`adjustTimer`) and from the dashboard (±minutes, pause/resume), independent of session pause.
- **Restart recovery** — live session state (vars, phase, timer) is persisted; on server restart, non-ended sessions are rebuilt without re-firing `session:start`. Mid-flight sequences are lost by design and logged.

## 6. Communication Protocol (Socket.io)

Two namespaces (`@roomkit/shared` `protocol.ts`):

### `/device` — for devices

Auth handshake: `{ deviceCode, deviceName? }`. Resolution order: test codes first (attach to that test session), then device-asset codes matched to the theme's live production session; a valid production code with no active session parks the socket in the **lobby** until one starts. Unknown code → fatal `invalid_code`; ended session → fatal `session_ended` (clients using `retryOnFatalError` keep polling anyway — this is how room devices boot before the session exists).

| Direction | Event                                                      | Purpose                                                        |
| --------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| S→C       | `welcome`                                                  | once on attach: device identity + session state                |
| S→C       | `command`                                                  | a wire command (play/stop/navigate/reset/message)              |
| C→S       | `ack`                                                      | `{ commandId, status }` — resolves `waitUntilEnd`              |
| C→S       | `trigger`                                                  | `{ event, payload? }` — report a game event                    |
| C↔S       | `progress`                                                 | dialogue line sync, speaker → server → screen                  |
| C→S       | `hint:submit`, `hint:next` / S→C `hint:show`, `hint:error` | hint flow (hint devices only)                                  |
| S→C       | `session:state`                                            | phase / pause / timer broadcasts                               |
| C→S (ack) | `assets:manifest`                                          | returns the device's pre-cache manifest (presigned URLs, ~6 h) |

### `/admin` — for studio

Auth handshake: `{ token }` (the admin JWT). Broadcast-only: `session:state`, `log` (live session log entries), `device:status` (online/offline per device). All session **control** goes through REST (`POST /sessions/:id/start|pause|resume|end|timer|phase|trigger|reset-devices|hint`).

## 7. Server Surface (quick reference)

All REST routes are under `/api` and JWT-guarded unless noted. Auth is a **single admin account** (`ADMIN_ID` / `ADMIN_PASSWORD_HASH` env, bcrypt), `POST /auth/login` → JWT (12 h).

- `GET|POST /themes`, `GET|PATCH|DELETE /themes/:id`, `POST /themes/:id/duplicate`
- `GET|POST /themes/:themeId/assets` (`?kind=&tagId=`), `GET|PATCH|DELETE .../assets/:id`
- `GET|POST|PATCH|DELETE /themes/:themeId/tags[...]`
- `POST /themes/:themeId/uploads` — presign a single-file PUT; `GET /files/url?key=` — presign a GET
- `POST /themes/:themeId/imports/:kind` — bulk media zip (bgm/sfx/video/dialogue); `POST /themes/:themeId/imports/site` — hosted website zip
- `GET /sites/:assetId/*` — public, serves hosted website files from S3
- `GET|POST /sessions`, `GET|DELETE /sessions/:id`, lifecycle/control POSTs listed above
- `GET /sessions/:id/logs?afterId=&limit=` — paginated log read
- `GET /health` — public

Uploads go **directly to S3** via presigned URLs (the server only handles metadata) — except zips (bulk media, dialogue, hosted sites), which the server receives, extracts with streaming (yauzl), and pushes to S3 file by file.

## 8. The Player App and Website Integration

The player (`apps/player`) is the reference device implementation:

- The **launcher** window configures the server URL and a list of devices (label, code, kiosk flag), persisted to `config.json`. Each device opens as its own **stage window**, so one machine can host several devices (useful for testing).
- Stage windows connect with `retryOnFatalError`, so room hardware can be powered on before the session or its test code exists and attach on its own.
- On connect the player fetches the device's **asset manifest** and caches media locally (keyed by immutable `fileKey`; presence = fresh). Cache misses stream the presigned URL and backfill in the background.
- It implements mixed audio (BGM + SFX + dialogue simultaneously), video, and a subtitle overlay that applies the player asset's `subtitleCss` and renders subtitle HTML.
- **Kiosk mode** locks the window fullscreen/always-on-top with browser shortcuts suppressed (escape chord: `Ctrl+Shift+Alt+F12`). OS-level chords can't be blocked from an app — use Windows Assigned Access for a hard lock.
- **Test mode** (when attached to a test session): a status bar (connection, session state, timer) and skip buttons for dialogue/video.
- The player has **no hint UI** — hint screens are content you build.

**Websites** integrate in one of two ways:

1. **Inside the player's iframe** (via the `navigate` command): embed `@roomkit/helper` (`dist/roomkit-helper.global.js`, global `RoomKitHelper`). It talks to the player over postMessage — `trigger()`, `on('message')`, `submitHint()`, `requestHintStep()`, `on('hint')` — riding the player's existing connection.
2. **Standalone** (own browser/kiosk, or any other platform): the site is a device in its own right and uses `@roomkit/client` with its own device code — full API including playback callbacks and `fetchAssetManifest()`.

## 9. Security Model

- One admin account; JWT bearer for REST and the `/admin` socket. Protecting this account (strong password, HTTPS) is the security perimeter.
- Devices authenticate by code only — codes are capabilities. Test codes are generated from an unambiguous alphabet; hosted-site URLs are guarded only by the unguessable asset UUID (sites are game content, not secrets).
- Subtitle HTML and eval code are authored by the admin and treated as **trusted input** — deliberately not sanitized.
