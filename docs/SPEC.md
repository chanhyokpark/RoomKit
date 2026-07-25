# RoomKit Spec

A toolkit for building, managing, and running escape room games. This document is the concretized version of the initial plan and serves as the reference before implementation.

## Settled Decisions

| Topic | Decision |
|---|---|
| Scope | One server manages **multiple themes** |
| Deployment | **Cloud server** (Postgres + S3-compatible storage) |
| Auth | **Single admin account** (one id+password, JWT Bearer) |
| Production sessions | **One concurrent session per theme**. Multiple rooms of the same theme are handled by duplicating the theme |
| Test sessions | Multiple concurrent test sessions per theme |
| Website asset | **External URL or hosted zip**. External sites are registered by URL; hosted sites are uploaded as a zip, extracted to S3, and served by the server at `/api/sites/{assetId}/`. Sites opened inside the player's iframe embed the helper script; standalone websites and other platforms use `@roomkit/client` instead |
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

Every asset, phase, event, and device belongs to a theme. Themes are duplicable (`POST themes/:id/duplicate`, deep copy) — for running multiple rooms of the same theme and for season-rework backups. The copy remaps every cross-asset id reference (player device refs, event phaseId, sequence command refs, component attachments) to the new ids; device/hint codes copy verbatim (they are unique per theme); S3 fileKeys are shared with the source, not copied.

### Assets

Common fields: `id`, `themeId`, `name`, `description`, `tags[]`, `createdAt`. File-backed assets hold an S3 key. Uploads use presigned URLs (the server only handles metadata), except zip uploads (bulk media, dialogue, hosted websites), which the server receives, extracts, and pushes to S3 file by file.

**Bulk zip upload** (`POST themes/:id/imports/:kind`, kind = bgm/sfx/video/dialogue): every media file in the zip becomes a new asset named after its filename (always create, no dedup). For dialogue, files named `name_1.mp3`, `name_2.mp3` group into one dialogue named `name` with lines ordered by the numeric suffix; files without a suffix become single-line dialogues. Junk entries (`__MACOSX/`, dotfiles, unsupported extensions) are skipped and reported.

**Placeholder (fileless) media**: bgm/sfx/video assets and dialogue lines may be created without a file (`fileKey: null`) for testing before real media exists. Each carries a `durationMs` (defaults: bgm/sfx 2s, video 5s, dialogue line 3s; editable). The wire command then carries `url: null` + `durationMs`; clients show a placeholder, simulate playback for that long, and ack as usual (`waitUntilEnd` works unchanged). Placeholders are excluded from the device asset manifest.

Every kind — including Phase and Event — is stored as an `Asset` row (`kind` enum + per-kind `data` JSON validated by zod).

| Asset | Fields / behavior |
|---|---|
| Device | `name` (logical identifier), `displayName` (human-friendly label for UIs), `code` (unique within theme, used for production device registration), `isHintDevice`, hint-code overlay styling (`hintCodeCss`, or a `hintCodeComponent` attachment that replaces the default overlay). Test device codes are issued separately and stored in the client's localStorage |
| BGM | one audio file |
| Dialogue | multiple ordered voice files. Per-file subtitle (HTML allowed). `keepSubtitleAfterEnd` flag. Optional `subtitleComponent` attachment overrides the player's subtitle rendering for this dialogue. On zip upload, lines are created in filename order; subtitles are filled in on the edit screen |
| SFX | one audio file |
| Video | one video file. Optional `frame` (`{x, y, width, height}` in percent of the stage; null = fullscreen) places the video surface, and an optional Component attachment overlays custom UI (e.g. a chat screen) while it plays |
| Image | one image file. Not played by the studio runtime — a static resource for websites, served publicly at `/api/media/{assetId}` (stable URL; re-upload swaps the file behind it). Fileless images serve a generated SVG placeholder in a customizable `placeholderRatio` ("W:H", default 16:9), so sites can lay out before artwork exists |
| File | arbitrary file counterpart of Image, same public serving |
| Hint | `code` (auto-generated, unique within theme — 4 digits by default, manually editable), array of steps. Each step is text (HTML) + optional image |
| Player | logical output group. `speakerDeviceId`, `screenDeviceId` (device that renders subtitles/video), `subtitleCss`, optional default `subtitleComponent`. Subtitle rendering resolves dialogue's component -> player's component -> default `.rk-subtitle` overlay + `subtitleCss`. Dialogue/video playback commands target a player, not a raw device |
| Website | `mode: external \| hosted`. External: only a `url` is registered. Hosted: a zip (with `index.html` at its root; a single wrapping folder is auto-stripped) is extracted to an immutable S3 prefix (`sitePrefix`) and served by the server at `/api/sites/{assetId}/`; re-upload swaps the prefix. If the site is shown inside the player's iframe, it must have the helper script embedded; a standalone site connects with `@roomkit/client` instead |
| Message | payload **schema** delivered to a device. `displayName` + `fields[]` (`key`, `label`, `type`: string/number/boolean/json, `required`). The asset only defines the shape; concrete values are entered dynamically in the editor when authoring a "send message to device" command |
| Component | reusable HTML document (inline `<style>`/`<script>` allowed; trusted admin input) mounted on the stage in a sandboxed iframe for one `slot`: `video` (overlay while a video plays), `subtitle`, or `hintCode`. `params[]` (message-field shape) declares per-attachment props, so one component serves many assets with different values (`{componentId, props}` refs live on video/dialogue/player/device data). `interactive` opts into pointer events. Inside the iframe, `window.RoomKit` exposes `props`, `mediaUrl(assetId)`, and events: `video` (`{status, currentTimeMs, durationMs}`), `subtitle` (`{html, lineIndex, lineCount}`), `hintCode` (`{code}`), and `message` (every sendMessage wire). The studio component editor has a live preview (same iframe host as the player) with mock slot events, test props, and aspect presets; a broken/dangling component ref degrades to the default overlay rendering server-side, never cancelling playback |
| Tag | `name`, `color`. Many-to-many with assets, organization only (no runtime meaning) |
| Phase | `name`, `order`. Game progression stage. A session is always in exactly one phase |
| Event | `phaseId` (null = common), `triggerKind`, `triggerName`, `manualTriggerable`, `allowReentry`, `sequence`. See below |

### Events and Sequences

All logic starts from an event.

- Ownership: an event belongs to a specific phase or is **common** (valid in every phase)
- Trigger kinds:
  - **Device trigger**: a device reports an event name via a `trigger` message (e.g. sensor, button)
  - **Manual trigger**: invoked directly from the admin page. Per-event `manualTriggerable` flag
  - **System trigger**: run automatically on session start, phase enter/leave (per-phase hooks), and timer expiry. Starting a session also fires `phase:enter` for the initial phase
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
| Play/stop BGM | bgm, player, `loop`, `fadeInMs` / `fadeOutMs` | infinite loop toggle; optional volume fade on play (fade-in) and stop (fade-out) |
| Wait | duration (ms) | server timer. Pauses together with session pause |
| Navigate device to website | device, website | sends `navigate(url)` to the device |
| Send message to device | device, message, values | builds the payload from the message asset's field schema + values entered in the editor, then sends it to the device. Tauri relays it to the iframe via postMessage |
| Switch phase | phase | changes the session phase + runs phase hooks *(not a command in the original plan, but added so "jump to a specific phase" is usable from sequences too)* |
| Call event | event | runs another event's sequence (for reuse; proposed addition) |
| Reset all devices | — | sends `reset` to every device in the session (bulk version of "reset device") |
| Adjust timer | delta (±ms) or pause/resume | grants bonus/penalty time or pauses the countdown from a sequence |
| End theme | verdict (success/fail) | game over: resets every device and records the verdict, which the operation screen displays. The session stays live — the operator ends it manually |
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
Session: id, themeId, mode(test|production), phaseId, state(created|running|paused|ended),
         verdict(success|fail, null until endTheme runs), vars(json), startedAt, endedAt,
         timerEndsAt, timerRemainingMs (while paused)
```

- **Lifecycle**: sessions are created **idle** (`created`) and started explicitly from the dashboard (start button; warns when devices are offline). Devices may connect to an idle session so the operator can check online status before starting. The timer arms and `session:start` fires only on start
- **Production**: one concurrent session per theme. Production devices (physical, registered by code) automatically belong to this session
- **Test**: multiple sessions may exist. On creation, the operator **enters a test device code** for each device (the form pre-fills suggestions). Codes are freed when the session ends
  - Testers attach devices with the test code — the tauri player in **testing mode**, or any `@roomkit/client` consumer (there is no virtual device page in studio; studio only runs/manages test sessions)
  - Clients store the test code in localStorage to auto-rejoin on reconnect
  - Test-mode clients show skip buttons for dialogue/video (tauri testing mode, M5)
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
| S→C | `welcome` | `{ device, session }` — sent once on successful attach |
| S→C | `command` | `{ id, type, ... }` (play, stop, navigate, reset, message; play carries presigned media URLs) |
| C→S | `ack` | `{ commandId, status }` — resolves waitUntilEnd |
| C→S | `trigger` | `{ event, payload? }` — reports a game event |
| C→S / S→C | `progress` | `{ commandId, lineIndex }` — dialogue line sync from speaker, relayed to the screen device |
| C→S | `hint:submit` / S→C `hint:show` | hint device only |
| S→C | `session:state` | broadcast of phase changes, pause, remaining timer, etc. |
| C→S (ack) | `assets:manifest` | request → `DeviceAssetManifest`: the media files this device should pre-cache (speaker → bgm/sfx/dialogue lines, screen → video) with presigned URLs. Served while attached or lobby-parked |

**`/admin`** — for studio. Authenticated with the admin token.

- Subscribe to session list/state, log stream (events, errors, hint usage), device online status, and `session:runs` (live snapshot of in-flight event sequences: event name, current command index/type)
- Manual event trigger, forced phase switch, current-phase restart (re-fires leave + enter hooks), session start/pause/end, timer adjust (±minutes, pause/resume), bulk device reset

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

- **Authoring**: theme list → asset management (kind tabs, tag filters; audio/video/dialogue lines are directly playable from the list), editor
- **Editor**:
  - Tab per phase workspace + a "common" workspace
  - Event card list → clicking an event opens an iOS-Shortcuts-style vertical command stack editor (drag to reorder, add from a command palette)
  - When picking an asset in a command parameter, a new asset can be created inline (modal)
- **Operation (management)**: session dashboard — session start (with offline-device warning and optional pre-start bulk reset), current phase, countdown timer (with adjust controls), runnable event buttons (`manualTriggerable`), forced phase switch, live logs, device online status, hint push, bulk device reset, test session runner (create test sessions with operator-entered device codes)

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
// ack once the site has actually changed — the server sequence waits on it
rk.on('navigate', (url, cmd, done) => ...);
// playback commands are exposed as callbacks — playback itself is up to the user; call ack when done
rk.on('play', (cmd, done) => ...);
// hint UIs (any device/website) are built on these — the player has none built in
rk.submitHint('0417');
rk.requestHintStep(hintId, 1);
rk.on('hint', (show) => ...);
rk.on('hintError', (err) => ...);
// media manifest for pre-caching (presigned URLs, ~6h)
const manifest = await rk.fetchAssetManifest();
```

### Tauri client (apps/player)

- Built on `@roomkit/client`. A **launcher** window opens on every start: server URL + a device list (label, device code, kiosk toggle), persisted to `config.json`. Each device opens as its own stage window (`device-<id>`), so several devices can run on one machine for testing
- Stage windows connect with `retryOnFatalError`: an `invalid_code` / `session_ended` doesn't stop the client — it keeps polling (5s), so devices can be powered on **before** the session or their test code exists and attach on their own once the operator creates it
- On connect, fetches `assets:manifest` and downloads the files to a local cache (fileKey-based refresh — upload keys are immutable, so presence = fresh). Cache miss streams the wire command's presigned URL and backfills in the background
- Fullscreen kiosk lock per device (window-level: fullscreen, always-on-top, hidden cursor, close prevention, browser-shortcut suppression; escape chord Ctrl+Shift+Alt+F12). OS chords (Win key, Alt+Tab) cannot be blocked from an app — use Windows Assigned Access for a hard lock
- Implements audio (dialogue/BGM/SFX mixed simultaneously), video (fullscreen or placed by the video asset's `frame`), and subtitle overlay (applies the player's `subtitleCss`, renders subtitle HTML) directly. Component attachments (video overlay / subtitle / hint code) mount as sandboxed `srcdoc` iframes fed by the `window.RoomKit` postMessage bridge (`@roomkit/shared` `component-host.ts` — the same host the studio preview uses)
- Websites are shown in an embedded webview (iframe) — communicates with the helper script via postMessage (`@roomkit/shared` `helper.ts` envelopes; the player buffers until the helper's `hello`)
- No hint UI in the player: hint UIs are built by client/helper consumers
- Test mode: skip button overlay (dialogue/video) + status bar (connection, session state, timer)

### @roomkit/helper (iframe embed script)

Embedded via `<script>` into websites that are opened **inside the player's iframe** (via the "navigate device to website" command). It does not open its own connection — all trigger/message traffic goes through the parent (tauri) via `postMessage`, riding on the player's existing device connection.

The API is a subset of the client library: `trigger()`, `on('message')`, plus the hint surface (`submitHint()`, `requestHintStep()`, `on('hint')`, `on('hintError')`). The postMessage envelopes live in `@roomkit/shared` (`helper.ts`); the iife bundle (`dist/roomkit-helper.global.js`, ~1.5KB, defines `window.RoomKitHelper`) does structural checks only, while the player validates with the zod schemas.

Websites opened standalone (in a regular browser, outside the player) and other platforms are devices in their own right: they use `@roomkit/client` to connect to the websocket directly with their own device code, not the helper script.

## Security Note on Subtitle HTML and Eval

Subtitle HTML and eval code are authored only by the creator (admin account) — treated as trusted input, not sanitized. Protecting the admin account (password, HTTPS) is the prerequisite instead.

## Milestones

1. **M1 Core**: shared protocol, server (auth/themes/assets CRUD, S3), studio asset management
2. **M2 Runtime**: sessions + test sessions (REST), sequence runtime, countdown timer, /device + minimal /admin gateways, session logs, `@roomkit/client`
3. **M3 Editor**: phase/event editing UI, command stack editor, inline asset creation
4. **M4 Operation**: admin dashboard, test session runner UI, logs UI, hint flow, manual trigger / phase switch
5. **M5 Clients**: tauri player (asset cache, playback, subtitles, testing mode w/ skip buttons), helper script
6. **M6 Polish**: theme duplication, bulk zip upload (bgm/sfx/video/dialogue with `name_N` grouping), hosted website zip upload + server-side serving, placeholder (fileless) media assets, error handling & reconnect hardening (device detach on session end, playback stop on end, unhandled-rejection safety, admin reconnect refresh)
