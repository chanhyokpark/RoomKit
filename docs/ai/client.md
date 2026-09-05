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

Status is `idle | connecting | connected | disconnected | error`. Fatal errors include invalid code and ended session. By default Client stops retrying; `retryOnFatalError` supports devices that boot before a session/code exists. When the server closes the socket (it detaches every device socket of an ended session), Client reopens a fresh socket after one second so the handshake re-runs: a production code lands in the lobby or the theme's next live session, a freed test code falls into the fatal-error path. A successfully used test code can be stored per server origin and preferred on reconnect. Disable or override storage when multiple logical devices share one browser origin.

## Automatic versus owner acknowledgments

Client validates inbound schemas, deduplicates command IDs, and automatically acknowledges reset, stop, BGM-volume, non-awaited messages, and hint-code commands. The consumer owns completion for `play` and `navigate`. A `done()` callback is idempotent and accepts `done()` or `done('failed')`.

Message listeners may return promises. For `awaitHandled` commands, Client waits for all listeners before acknowledging. Without the flag, it acknowledges before invoking them.

## Playback

Every play command has id, channel, player/asset identity, and either URL/file metadata or placeholder duration.

- **BGM:** implement loop and fades. A loop acknowledges at start. Store fade-out for later stop/replacement. Handle `bgmVolume` by applying `cmd.value` (0–1) as the player's persistent base volume until reset, ramping linearly over `cmd.durationMs` when it is above 0; fade and duck factors multiply it.
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

## API reference

Complete public surface, kept in sync with the shipped types — no SDK source lookup needed. `JsonValue`, `HintShow`, `HintError`, `SessionMode`, and `VideoFrame` are identical to the definitions in [Helper integration](./helper.md#api-reference).

### `RoomKitClient`

```ts
type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';
/** Completion callback for owner-acked commands. Idempotent; default 'done'. */
type DoneFn = (status?: 'done' | 'failed') => void;
type CodeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** localStorage key used for stored test codes, scoped per server origin. */
function testCodeKey(serverUrl: string): string;

interface RoomKitClientOptions {
  serverUrl: string;           // http(s) origin, e.g. 'http://localhost:3000'
  deviceCode: string;          // production code or operator-issued test code
  deviceName?: string;         // handshake label (logs only)
  persistTestCode?: boolean;   // default true; store/prefer test codes per origin.
                               // Set false (or scope `storage`) when several devices share one origin.
  storage?: CodeStorage;       // default localStorage (no-op store in Node)
  retryOnFatalError?: boolean; // default false; keep polling through invalid_code/session_ended
  fatalRetryDelayMs?: number;  // default 5000
  debug?: boolean;             // default false; console-log lifecycle + traffic as '[roomkit]'
}

interface GetRemainingTimeOptions { resync?: boolean; timeoutMs?: number } // defaults false / 10000

interface RoomKitClientEvents {
  welcome: [Welcome];                            // once per successful attach
  play: [WirePlayCommand, DoneFn];               // consumer plays media, calls done() when finished
                                                 // (looping BGM: done() on start; placeholder: after durationMs)
  stop: [WireStop];
  bgmVolume: [WireBgmVolume];                    // persistent base-volume factor for one player's BGM
  navigate: [string, WireNavigate, DoneFn];      // (url, cmd, done) — done() after the target actually loaded
  message: [Record<string, JsonValue>, WireMessage]; // listener may return a promise (awaitHandled ack)
  reset: [WireReset];
  progress: [PlaybackProgress];                  // subtitle sync (screen role) / cue go-ahead (speaker role)
  sessionState: [SessionState];
  status: [ConnectionStatus, string?];           // detail = connect_error message when present
  hint: [HintShow];                              // reply to submitHint/requestHintStep, or operator push
  hintError: [HintError];
  hintCode: [WireHintCode];                      // show (code set) / hide (code null) the entry-code overlay
  testCallback: [WireTestCallback, DoneFn];      // debug window asked to run a registered test callback
}

class RoomKitClient {
  constructor(options: RoomKitClientOptions);
  get status(): ConnectionStatus;
  get sessionState(): SessionState | null;       // last received snapshot
  connect(): void;                               // no-op while a socket exists
  disconnect(): void;                            // status → 'idle'
  trigger(event: string, payload?: JsonValue): void;
  /** Resolves when every run the trigger started finished. Rejects when not
   *  connected or after timeoutMs (default 600000; runs keep going server-side). */
  triggerAndWait(event: string, payload?: JsonValue, timeoutMs?: number): Promise<void>;
  submitHint(code: string): void;                       // hint devices only
  requestHintStep(hintId: string, step: number): void;  // step `stepCount` = explicit answer
  /** Local tick from the last snapshot; `resync: true` refreshes it first (best effort). */
  getRemainingTime(options?: GetRemainingTimeOptions): Promise<number | null>;
  /** Media to pre-cache; presigned URLs (~6h, see urlExpiresAt). Rejects when
   *  not connected, on timeout, or when the socket has no theme. */
  fetchAssetManifest(timeoutMs?: number): Promise<DeviceAssetManifest>;
  /** Speaker-role dialogue sync; `waiting: true` reports a holdBefore pause. */
  sendProgress(commandId: string, lineIndex: number, waiting?: boolean): void;
  /** Player-internal: relay the embedded website's helper version/names. */
  reportHelperInfo(version: string | null, extras?: { messages?: string[]; testCallbacks?: string[] }): void;
  on<K extends keyof RoomKitClientEvents>(event: K, listener: (...args: RoomKitClientEvents[K]) => void): this;
  off<K extends keyof RoomKitClientEvents>(event: K, listener: (...args: RoomKitClientEvents[K]) => void): this;
}

const CLIENT_VERSION: string; // sent in the connection auth
```

### Session and manifest payloads

```ts
type SessionStateValue = 'created' | 'running' | 'paused' | 'ended';
type TimerState = 'running' | 'paused' | 'expired';

interface SessionState {
  sessionId: string;
  themeId: string;
  mode: 'test' | 'production';
  phaseId: string | null;
  state: SessionStateValue;
  verdict: 'success' | 'fail' | null;    // set by the endTheme command
  timerState: TimerState | null;         // null = theme has no timer
  timerRemainingMs: number | null;       // snapshot at emit time; tick locally while 'running'
}

interface Welcome {
  device: { id: string; name: string; displayName: string };
  session: SessionState;
}

interface DeviceAssetEntry {
  assetId: string;
  kind: 'bgm' | 'sfx' | 'video' | 'dialogue';
  name: string;
  lineId?: string;      // dialogue entries only (one entry per line)
  fileKey: string;      // immutable — presence in a local cache = fresh
  url: string;          // presigned GET URL
}

interface DeviceAssetManifest {
  themeId: string;
  deviceId: string;
  urlExpiresAt: number; // epoch ms; re-request before then
  entries: DeviceAssetEntry[];
}

interface PlaybackProgress {
  commandId: string;
  lineIndex: number;    // 0-based
  waiting: boolean;     // speaker is holding before this line (C→S only)
}
```

### Wire commands

`id` is the delivery id — redeliveries reuse it and Client dedupes/re-acks automatically. Media invariant on every play wire: `fileKey === null ⇔ url === null ⇔ durationMs !== null` (null media = fileless placeholder: simulate for `durationMs`, then ack as usual).

```ts
type WireCommand =
  | WirePlayCommand | WireStop | WireBgmVolume | WireNavigate
  | WireReset | WireMessage | WireHintCode | WireTestCallback;

type WirePlayCommand = WirePlayBgm | WirePlaySfx | WirePlayDialogue | WirePlayVideo;

interface WirePlayBgm {
  id: string; type: 'play'; channel: 'bgm';
  playerId: string; assetId: string; assetName: string;
  fileKey: string | null; url: string | null; durationMs: number | null;
  loop: boolean;      // looping tracks ack on playback start
  fadeInMs: number;   // volume ramp from 0 on start; 0 = none
  fadeOutMs: number;  // stored by the client, applied on later stop/replacement
}

interface WirePlaySfx {
  id: string; type: 'play'; channel: 'sfx';
  playerId: string; assetId: string; assetName: string;
  fileKey: string | null; url: string | null; durationMs: number | null;
  bgmDuck?: number;   // 0..1 BGM factor while the SFX plays; absent = no ducking. Ramp down fast (~250ms), release slowly (~1s)
}

interface WireDialogueLine {
  lineId: string;
  fileKey: string | null; url: string | null; durationMs: number | null;
  subtitleHtml: string;
  holdBefore: boolean; // speaker pauses before this line: sendProgress(id, index, true),
                       // then wait for the server's plain progress go-ahead
}

interface WirePlayDialogue {
  id: string; type: 'play'; channel: 'dialogue';
  playerId: string; assetId: string; assetName: string;
  role: 'speaker' | 'screen' | 'both';
  lines: WireDialogueLine[];
  subtitleCss: string;                // trusted admin CSS
  keepSubtitleAfterEnd: boolean;
  params: Record<string, JsonValue>;  // dialogue asset's free-form params
  bgmDuck?: number;                   // speaker role only
}

interface WirePlayVideo {
  id: string; type: 'play'; channel: 'video';
  playerId: string; assetId: string; assetName: string;
  fileKey: string | null; url: string | null; durationMs: number | null;
  frame: VideoFrame | null;           // percent placement; null = fullscreen
  params: Record<string, JsonValue>;
}

interface WireStop {
  id: string; type: 'stop';
  channel: 'bgm' | 'sfx' | 'dialogue' | 'video';
  playerId: string | null;            // null = every player on this channel
}

interface WireBgmVolume { id: string; type: 'bgmVolume'; playerId: string; value: number; durationMs: number } // 0..1, until reset; ramp ms (0 = instant)

interface WireNavigate {
  id: string; type: 'navigate';
  websiteId: string; url: string;
  force: boolean;                     // recreate the iframe even for an unchanged URL
}

interface WireReset { id: string; type: 'reset' }

interface WireHintCode {
  id: string; type: 'hintCode';
  code: string | null;                // null = hide the overlay
  css: string;                        // device asset's hintCodeCss (trusted admin input)
  params: Record<string, JsonValue>;  // hint asset's free-form params
}

interface WireMessage {
  id: string; type: 'message';
  messageId: string; messageName: string;
  payload: Record<string, JsonValue>;
  awaitHandled?: boolean;             // true: ack deferred until message listeners settle
}

interface WireTestCallback { id: string; type: 'testCallback'; name: string } // test sessions only
```
