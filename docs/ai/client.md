# `@roomkit/client` Direct Device Contract

[AI documentation index](../TOC_AI.md) · [Complete React example](../../templates/web_custom/README.md)

Use Client for standalone browsers, hardware controllers, custom kiosks, and any device that owns its RoomKit Socket.io connection. Player itself is the reference implementation. Do not open a second Client connection from a website embedded in Player; use Helper there.

## Installation

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/client"
```

pnpm 10 consumers must first allow the package's build script; see [library installation from GitHub](./environment.md#library-installation-from-github).

## Connection

```ts
const client = new RoomKitClient({
  serverUrl,
  deviceCode,
  deviceName,
  persistTestCode: true,
  retryOnFatalError: true,
  fatalRetryDelayMs: 5000,
  debug: false,
});
client.connect();
```

Status is `idle | connecting | connected | disconnected | error`. Fatal errors include invalid code and ended session. By default Client stops retrying; `retryOnFatalError` supports devices that boot before a session/code exists. A successfully used test code can be stored per server origin and preferred on reconnect. Disable or override storage when multiple logical devices share one browser origin.

## Automatic versus owner acknowledgments

Client validates inbound schemas, deduplicates command IDs, and automatically acknowledges reset, stop, BGM-volume, non-awaited messages, and hint-code commands. The consumer owns completion for `play` and `navigate`. A `done()` callback is idempotent and accepts `done()` or `done('failed')`.

Message listeners may return promises. For `awaitHandled` commands, Client waits for all listeners before acknowledging. Without the flag, it acknowledges before invoking them.

## Playback

Every play command has id, channel, player/asset identity, and either URL/file metadata or placeholder duration.

- **BGM:** implement loop and fades. A loop acknowledges at start. Store fade-out for later stop/replacement. Handle `bgmVolume` by applying `cmd.value` (0–1) as the player's persistent base volume until reset; fade and duck factors multiply it.
- **SFX:** play independently and apply optional `bgmDuck` while active.
- **Dialogue speaker:** play ordered lines; emit `sendProgress(id, index)` as each starts. For `holdBefore`, emit waiting progress first and wait for the server's non-waiting progress before starting that line. Finish after the last line.
- **Dialogue screen:** acknowledge play immediately, retain the dialogue command, and render line subtitle HTML on matching progress. Clear at end unless `keepSubtitleAfterEnd`, and always clear on stop.
- **Dialogue both:** combine speaker and screen behavior locally. Server progress is still required for cue holds.
- **Video:** place using percentage frame or full-screen, apply params, and acknowledge on end/error.

Stop has a channel and optional player target. Stop active elements, cancel timers/fades/holds, clear relevant state, and ensure any owned pending completion is settled exactly once.

## Navigation and reset

`navigate(url, cmd, done)` must acknowledge after the actual target loads. Embedding the target in an iframe preserves the Client socket. Navigating the entire page destroys the socket, so invoke `done()` immediately before assigning `location.href` if that model is intentional.

Reset should stop all media, clear subtitles/overlays, reset the embedded website or puzzle state, and return to a known initial UI.

## Device-originated operations

- `trigger(event, payload?)` is fire-and-forget.
- `triggerAndWait(event, payload?, timeoutMs?)` waits for all runs started by the trigger; default ten minutes.
- `submitHint` and `requestHintStep` drive hint UI.
- `getRemainingTime({ resync?, timeoutMs? })` computes from the last state or requests a fresh snapshot.
- `fetchAssetManifest()` returns role-scoped media and presigned URLs for pre-caching.

Presigned manifest URLs expire; refresh before long downloads. File keys are immutable, so cache presence by key is sufficient and entries removed from the latest manifest may be pruned.
