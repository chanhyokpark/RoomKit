# RoomKit Spec

A toolkit for building, managing, and running escape room games. This document is the concretized version of the initial plan and serves as the reference before implementation.

## Settled Decisions

| Topic | Decision |
|---|---|
| Scope | One server manages **multiple themes** |
| Deployment | **Cloud server** (Postgres + S3-compatible storage) |
| Auth | **Single admin account** (one email+password, session cookie/JWT) |
| Production sessions | **One concurrent session per theme**. Multiple rooms of the same theme are handled by duplicating the theme |
| Test sessions | Multiple concurrent test sessions per theme |
| Website asset | **External URL registration only**. Sites opened inside the player's iframe embed the helper script; standalone websites and other platforms use `@roomkit/client` instead |
| Hint delivery | Players **enter a code on a hint device** in the room → step-by-step hints shown |
| JS eval | **Server-side execution** (for session variables and branching logic) |
| Tag | **Label for asset organization** (filtering/search in the editor and admin UI) |
| Countdown timer | **Included**. Per-theme time limit, timeout fires a system event |
| Subtitle timing | **Per voice file** — no time-coded (SRT-style) subtitles within a file |
| Team turnover | End session → start new session, plus a **built-in bulk device reset** |

## Repository Layout (pnpm monorepo)

```
RoomKit/
├── apps/
│   ├── server/      # NestJS main server (REST + Socket.io + sequence runtime)
│   ├── studio/      # SvelteKit authoring & management frontend
│   └── player/      # Tauri client (for devices)
├── packages/
│   ├── client/      # @roomkit/client — js library (websocket, service class)
│   ├── helper/      # @roomkit/helper — script for iframe-embedded websites (iife bundle)
│   └── shared/      # types, protocol definitions, command schemas (zod)
└── docs/
```

- Language: TypeScript everywhere
- Server ORM: Prisma
- Protocol types are defined as zod schemas in `shared` and shared by server/client/studio

## Core Concepts and Data Model

### Theme

Every asset, phase, event, and device belongs to a theme. Themes must be duplicable (deep copy) — for running multiple rooms of the same theme and for season-rework backups.

### Assets

Common fields: `id`, `themeId`, `name`, `tags[]`, `createdAt`. File-backed assets hold an S3 key. Uploads use presigned URLs (the server only handles metadata), except dialogue zip uploads, which the server receives, extracts, and pushes to S3 file by file.

| Asset | Fields / behavior |
|---|---|
| Device | `name`, `code` (unique within theme, used for production device registration). Test device codes are issued separately and stored in the client's localStorage |
| BGM | one audio file |
| Dialogue | multiple ordered voice files. Per-file subtitle (HTML allowed). `keepSubtitleAfterEnd` flag. On zip upload, lines are created in filename order; subtitles are filled in on the edit screen |
| SFX | one audio file |
| Video | one video file |
| Hint | `code` (auto-generated, unique within theme — 4 digits by default, manually editable), array of steps. Each step is text (HTML) + optional image |
| Player | logical output group. `speakerDeviceId`, `screenDeviceId` (device that renders subtitles/video), `subtitleCss`. Dialogue/video playback commands target a player, not a raw device |
| Website | only a `url` is registered. If the site is shown inside the player's iframe, it must have the helper script embedded; a standalone site connects with `@roomkit/client` instead |
| Message | payload template delivered to a device. `payload` (JSON or string). Selected in the "send message to device" command |
| Tag | `name`, `color`. Many-to-many with assets, organization only (no runtime meaning) |
| Phase | `name`, `order`. Game progression stage. A session is always in exactly one phase |
| Event | see below |

### Events and Sequences

All logic starts from an event.

- Ownership: an event belongs to a specific phase or is **common** (valid in every phase)
- Trigger kinds:
  - **Device trigger**: a device reports an event name via a `trigger` message (e.g. sensor, button)
  - **Manual trigger**: invoked directly from the admin page. Per-event `manualTriggerable` flag
  - **System trigger**: run automatically on session start, phase enter/leave (per-phase hooks), and timer expiry
- Guard: only events belonging to the current phase (or common) can run. Out-of-phase triggers are ignored and only logged
- Concurrency: event sequences may run in parallel within a session (e.g. another event while BGM plays). Re-entry of the same event is blocked by default (optionally allowed)

A sequence is stored as an array of commands (JSON). The runtime lives on the server.

### Commands

| Command | Parameters | Behavior |
|---|---|---|
| Reset device | device | sends `reset` to the device (device returns to initial state) |
| Play/stop dialogue | dialogue, player, `waitUntilEnd` | voice to the speaker device, subtitles to the screen device. With `waitUntilEnd`, the sequence waits for the playback-finished ack |
| Play/stop SFX | sfx, player | |
| Play/stop video | video, player, `waitUntilEnd` | plays on the screen device |
| Play/stop BGM | bgm, player, `loop` | infinite loop toggle |
| Wait | duration (ms) | server timer. Pauses together with session pause |
| Navigate device to website | device, website | sends `navigate(url)` to the device |
| Send message to device | device, message | sends the payload to the device. Tauri relays it to the iframe via postMessage |
| Switch phase | phase | changes the session phase + runs phase hooks *(not a command in the original plan, but added so "jump to a specific phase" is usable from sequences too)* |
| Call event | event | runs another event's sequence (for reuse; proposed addition) |
| Reset all devices | — | sends `reset` to every device in the session (bulk version of "reset device") |
| Adjust timer | delta (±ms) or pause/resume | grants bonus/penalty time or pauses the countdown from a sequence |
| JavaScript eval | code | runs in the server sandbox |

**Eval sandbox**: `node:vm` + timeout (1s default). Injected API:

```ts
ctx.vars            // session variables (get/set)
ctx.phase           // current phase name (read)
ctx.trigger(name)   // trigger an event
ctx.log(msg)        // write to the session log
```

If the return value is `false`, the sequence stops → guard logic works without a dedicated branching command.

## Session Model

```
Session: id, themeId, mode(test|production), phaseId, state(running|paused|ended),
         vars(json), startedAt, endedAt,
         timerEndsAt, timerRemainingMs (while paused)
```

- **Production**: one concurrent session per theme. Production devices (physical, registered by code) automatically belong to this session
- **Test**: multiple sessions may exist. On creation, a per-session **test device code** is issued for each device
  - Testers open a virtual device page (inside studio) in a browser, or attach a physical device using the test code
  - Clients store the test code in localStorage to auto-rejoin on reconnect
  - Test-mode clients show skip buttons for dialogue/video
- Server restart recovery: session state (vars, phase, timer) is persisted to the DB. Sequences that were mid-flight are allowed to be lost but are logged (v1 simplification)

### Countdown Timer

- The theme defines a `timeLimit` (nullable — themes without a timer are allowed)
- The countdown starts on session start; pausing the session pauses the timer
- On expiry the server fires the `timer:expired` system trigger (an event the creator wires up — e.g. game-over dialogue)
- The remaining time is included in `session:state` broadcasts, so the admin UI and any screen device can render the countdown
- Adjustable from sequences (the "adjust timer" command) and from the admin dashboard (±minutes, pause/resume)

### Team Turnover

Between teams the operator ends the session and starts a new one. "Reset all devices" is provided as a built-in admin action (and as a sequence command), and is also offered as a one-click step when starting a new production session.

### Hint Flow

1. Designate which Device acts as the hint device (a `role: hint` flag on the device asset, or a theme setting)
2. The hint device (tauri/web) shows a code input UI → submits the code
3. The server looks up the hint for the current session/phase → shows step 1; a "next step" button advances
4. Usage (code, step, timestamp) is written to the session log and shown live in the admin UI
5. The operator can also push an arbitrary hint to the hint device from the management screen

## Communication Protocol (Socket.io)

Two namespaces:

**`/device`** — for clients (devices). Authenticates with `{ deviceCode }` on connect → matched to a session.

| Direction | Event | Payload |
|---|---|---|
| S→C | `command` | `{ id, type, ... }` (play, stop, navigate, reset, message, …) |
| C→S | `ack` | `{ commandId, status }` — resolves waitUntilEnd |
| C→S | `trigger` | `{ event, payload? }` — reports a game event |
| C→S | `hint:submit` / S→C `hint:show` | hint device only |
| S→C | `session:state` | broadcast of phase changes, pause, remaining timer, etc. |

**`/admin`** — for studio. Authenticated with the admin token.

- Subscribe to session list/state, log stream (events, errors, hint usage), device online status
- Manual event trigger, forced phase switch, session start/pause/end, timer adjust (±minutes, pause/resume), bulk device reset

Command delivery is at-least-once with `commandId` idempotency. If a device is offline, the command is logged as failed and the sequence continues (waitUntilEnd commands time out).

## Server (apps/server)

NestJS modules:

- `auth` — single-account login, token issuance
- `themes`, `assets` — CRUD, presigned uploads, zip handling (dialogue), theme duplication
- `sessions` — session lifecycle, session variables
- `runtime` — sequence runtime (in-memory, per-session state), eval sandbox, timers
- `gateway` — Socket.io gateways (`/device`, `/admin`)
- `logs` — session log (events, commands, errors, hints) storage & query

## Studio (apps/studio)

- **Authoring**: theme list → asset management (tag filters), editor
- **Editor**:
  - Tab per phase workspace + a "common" workspace
  - Event card list → clicking an event opens an iOS-Shortcuts-style vertical command stack editor (drag to reorder, add from a command palette)
  - When picking an asset in a command parameter, a new asset can be created inline (modal)
- **Operation (management)**: session dashboard — current phase, countdown timer (with adjust controls), runnable event buttons (`manualTriggerable`), forced phase switch, live logs, device online status, hint push, bulk device reset, open virtual devices (test)

## Clients

### @roomkit/client (js library)

The way any device connects to the server directly — used by the tauri player, standalone websites, and any other platform acting as a device. (Only iframe-embedded websites are the exception: they use the helper script instead.)

```ts
const rk = new RoomKitClient({
  serverUrl, deviceName, deviceCode,   // test mode: uses the test code from localStorage automatically
});
rk.connect();
rk.trigger('button-pressed');
rk.on('message', (payload) => ...);
rk.on('navigate', (url) => ...);
// playback commands are exposed as callbacks — playback itself is up to the user; call ack when done
rk.on('play', (cmd, done) => ...);
```

### Tauri client (apps/player)

- Built on `@roomkit/client`. First-run setup screen for server URL and device code
- On connect, receives the asset list needed by this device and downloads it to a local cache (hash-based refresh)
- Fullscreen lock, system shortcut blocking
- Implements audio (dialogue/BGM/SFX mixed simultaneously), video, and subtitle overlay (applies the player's `subtitleCss`, renders subtitle HTML) directly
- Websites are shown in an embedded webview (iframe) — communicates with the helper script via postMessage
- Test mode: skip button overlay during playback

### @roomkit/helper (iframe embed script)

Embedded via `<script>` into websites that are opened **inside the player's iframe** (via the "navigate device to website" command). It does not open its own connection — all trigger/message traffic goes through the parent (tauri) via `postMessage`, riding on the player's existing device connection.

The API is a subset of the client library: `trigger()`, `on('message')`.

Websites opened standalone (in a regular browser, outside the player) and other platforms are devices in their own right: they use `@roomkit/client` to connect to the websocket directly with their own device code, not the helper script.

## Security Note on Subtitle HTML and Eval

Subtitle HTML and eval code are authored only by the creator (admin account) — treated as trusted input, not sanitized. Protecting the admin account (password, HTTPS) is the prerequisite instead.

## Milestones

1. **M1 Core**: shared protocol, server (auth/themes/assets CRUD, S3), studio asset management
2. **M2 Runtime**: sessions, sequence runtime, countdown timer, /device gateway, js library, test sessions + virtual devices
3. **M3 Editor**: phase/event editing UI, command stack editor, inline asset creation
4. **M4 Operation**: admin dashboard, logs, hint flow, manual trigger / phase switch
5. **M5 Clients**: tauri player (asset cache, playback, subtitles), helper script
6. **M6 Polish**: theme duplication, dialogue zip upload, error handling & reconnect hardening
