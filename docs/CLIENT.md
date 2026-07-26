# @roomkit/client — Device Library Reference

`@roomkit/client` connects any custom device — a Raspberry Pi prop controller, a standalone kiosk website, a mobile app — directly to the RoomKit server over Socket.io (`/device` namespace). The Player desktop app is built on it, so the Player's handling is the reference implementation for every contract below.

It is a workspace-only package (`"@roomkit/client": "workspace:*"`, ESM + CJS + types) and runs in browsers and Node alike — the library does no media playback and touches no DOM; *you* react to commands and report back.

> Websites shown **inside the Player's iframe** must not use this library — they ride the Player's connection via [`@roomkit/helper`](./HELPER.md) instead.

For system concepts (sessions, events, commands) see [MANUAL.md](./MANUAL.md); §7 there is the quick tour, this is the full reference.

```ts
import { RoomKitClient } from '@roomkit/client';

const rk = new RoomKitClient({
  serverUrl: 'http://localhost:3000',
  deviceCode: 'lab-door',
  deviceName: 'door-controller',
  retryOnFatalError: true,
});
rk.connect();
```

---

## 1. Concepts

**Device codes.** A device authenticates with a code only (no secret): either a production 장치 코드 (authored on the device asset) or an operator-issued test code (issued per test session, freed when it ends). The server decides which; the client can't tell them apart up front — a test attach reveals itself in the `welcome` (`session.mode === 'test'`).

**Attach and lobby.** A production-coded device that connects before its session exists parks in a server-side lobby and attaches automatically the moment the session is created. `assets:manifest` works while lobby-parked, so pre-caching can start before the session does.

**Delivery is at-least-once.** Every wire command carries a delivery id; unacked commands are redelivered on reconnect. The client dedupes by id (window of 200): a redelivered command that already completed is re-acked with the same status and *not* re-emitted; one still in flight is ignored (the eventual `done()` covers it).

**The ack contract.** Apply-type commands (`stop`, `navigate`*, `reset`, `message`*, `hintCode`) are acked by the library immediately on dispatch. `play` and `navigate` hand you a `done` callback instead — the server sequence may be blocked on it (**끝날 때까지 대기**), so call it when the action truly finished. `done(status?)` accepts `'done'` (default) or `'failed'`; it is idempotent (second call is a no-op). A failed ack does not stop the sequence — it is logged and the sequence continues.

`message` has one exception: when the **메시지 전송** command was authored with **끝날 때까지 대기**, the wire carries `awaitHandled: true` and the ack is deferred until every `message` listener's *returned promise* settles — write an `async` handler (or return a promise) and the server sequence waits for it. Any rejection acks `'failed'`; sync handlers (or no handlers) settle immediately, so consumers that ignore the feature never stall a sequence.

---

## 2. Options

```ts
new RoomKitClient(options: RoomKitClientOptions)
```

| Option | Default | Meaning |
|---|---|---|
| `serverUrl` | — | http(s) origin of the server, e.g. `http://localhost:3000`. |
| `deviceCode` | — | Production device code or test code. |
| `deviceName` | — | Optional label sent in the handshake; shows up in logs. |
| `persistTestCode` | `true` | After a successful *test* attach, store the code (keyed `roomkit.testCode:<origin>`) and prefer it over `deviceCode` on the next `connect()` — auto-rejoin across reloads. The stored code is forgotten when the session ends or on any fatal connect error. Assumes one device per storage: set `false` (or scope `storage`) when several clients share one origin's localStorage — the Player does this for its windows — or they all attach as the same device. |
| `storage` | `localStorage` | Any `{ getItem, setItem, removeItem }` (`CodeStorage`). Defaults to `localStorage` when available, a no-op store otherwise (Node). |
| `retryOnFatalError` | `false` | By default a fatal connect error stops the client with status `error`. With this on, the client forgets any stored test code and re-polls with the configured `deviceCode` every `fatalRetryDelayMs` — so a room device can boot before its session/code exists and attach on its own, and rejoin after a session ends with a re-issued code. |
| `fatalRetryDelayMs` | `5000` | Delay between fatal-error retries. |
| `debug` | `false` | Log the connection lifecycle, inbound events/commands, and outbound emits to the console (prefixed `[roomkit]`). Invalid payloads are warned about regardless. |

---

## 3. Connection lifecycle

```ts
rk.connect();     // no-op when already connected/connecting
rk.disconnect();  // closes the socket, cancels retries, status → 'idle'
rk.status;        // ConnectionStatus getter
rk.on('status', (status, detail) => { ... });
```

`ConnectionStatus`: `idle → connecting → connected`, with `disconnected` on transport loss (socket.io auto-reconnects; `connected` follows on recovery) and `error` on an un-retried fatal error. `detail` carries the `connect_error` reason when there is one.

**Fatal vs transient connect errors.** `invalid_code` and `session_ended` are fatal (`FATAL_CONNECT_ERRORS` in `@roomkit/shared`): the code doesn't attach and won't by mere retrying — the client stops (or enters the `retryOnFatalError` poll loop, status stays `connecting`). Every other `connect_error` (network, server down) is transient: socket.io keeps retrying on its own, status stays `connecting`.

On successful attach the server sends `welcome` (device identity + session snapshot); the library re-emits it plus a synthetic `sessionState`. A malformed `welcome` or state payload is dropped with a console warning.

---

## 4. Methods

### `trigger(event, payload?)` → void

Report a game event (sensor, button, …). Fires matching **장치 트리거** events; `payload` is any JSON value, available to sequences as `{{payload.…}}` and `ctx.payload`. Fire-and-forget; silently dropped when not connected.

### `triggerAndWait(event, payload?, timeoutMs?)` → Promise\<void\>

Same report, resolving once the server has completely finished **every event run the trigger started** (immediately when nothing listened). Uses a socket.io ack under the hood.

- Default `timeoutMs` is **600 000 ms** (10 min) — runs can contain long waits and videos. On timeout the promise rejects but the runs continue server-side.
- A command failing inside a run does not reject; the run still completes.
- Rejects immediately when not connected, and on servers predating trigger acks.

### `sendProgress(commandId, lineIndex, waiting = false)` → void

Speaker-role dialogue only (see §6.3):

- Plain (`waiting: false`) — report that `lines[lineIndex]` just started playing; the server relays it to the screen device for subtitle sync.
- `waiting: true` — report that the speaker is **holding before** `lines[lineIndex]` (the line has `holdBefore: true`, i.e. an authored 라인 사이 커맨드 gap). The server runs the line-cue sequence, then answers with a plain `progress` event for the same `commandId`/`lineIndex` — the go-ahead to resume with that line.

### `submitHint(code)` / `requestHintStep(hintId, step)` → void

Hint-device only. `submitHint` submits a team-entered code; the reply is a `hint` event (step 0) or `hintError`. `requestHintStep` is stateless step navigation: ask for the exact 0-based step (`step + 1` for next, `step - 1` for back); out-of-range yields `hintError { reason: 'invalid_step' }`.

### `getRemainingTime(options?)` → Promise\<number | null\>

Remaining countdown ms, computed **locally** from the last session-state snapshot: ticks down while `timerState === 'running'`, frozen while paused, `0` when expired, `null` when the theme has no timer (or no snapshot yet). With `{ resync: true }` the server is asked for a fresh snapshot first over `session:sync` (best effort — falls back to the local value when disconnected or after `timeoutMs`, default 10 000 ms). Never rejects.

### `fetchAssetManifest(timeoutMs = 10_000)` → Promise\<DeviceAssetManifest\>

The media this device should pre-cache:

```ts
{ themeId, deviceId, urlExpiresAt, entries: [{ assetId, kind, name, lineId?, fileKey, url }] }
```

- Scoped per device role: speaker devices get `bgm`/`sfx`/`dialogue` entries (one per dialogue line, with `lineId`), screen devices get `video`. Placeholder (fileless) assets are excluded.
- `fileKey`s are immutable (`themes/{themeId}/{uuid}/{filename}`), so *presence in your cache = fresh* — no hashing; prune files that left the manifest.
- `url`s are presigned (~6 h; `urlExpiresAt` is the epoch-ms deadline) — re-call to refresh before long downloads.
- Works while attached *and* while lobby-parked. Rejects when not connected, on timeout, or when the socket has no theme (e.g. mid-reattach).

### `on(event, listener)` / `off(event, listener)` → this

Subscribe/unsubscribe; chainable. Events in §5.

### Getters

- `rk.status` — current `ConnectionStatus`.
- `rk.sessionState` — last `SessionState` snapshot, or `null` (see §5, `sessionState`).

---

## 5. Events

| Event | Listener args | Ack | Notes |
|---|---|---|---|
| `welcome` | `(welcome)` | — | Once per attach: `{ device: { id, name, displayName }, session: SessionState }`. Followed by a synthetic `sessionState`. |
| `play` | `(cmd, done)` | **you** | Play media on a channel — §6. Call `done()` when playback finishes (`'failed'` on error). |
| `stop` | `(cmd)` | auto | Stop `cmd.channel` (`'bgm' \| 'sfx' \| 'dialogue' \| 'video'`) for `cmd.playerId`; `playerId: null` = all players (the 모든 플레이어 option). Stopping dialogue also clears any visible subtitle; BGM stops honor the `fadeOutMs` delivered on the play wire. |
| `navigate` | `(url, cmd, done)` | **you** | Show the website at `url` (`cmd.websiteId` identifies the asset; `cmd.force` means recreate even for an unchanged URL — used by 웹 테스트 reload). Call `done()` once the site actually loaded. A consumer that navigates the whole window away must call `done()` *before* changing `location` — the socket unloads with the page. |
| `message` | `(payload, cmd)` | auto* | **메시지 전송** payload: `Record<string, JsonValue>` keyed by the message asset's field keys; `cmd.messageName`/`cmd.messageId` identify the asset. When `cmd.awaitHandled` is set (**끝날 때까지 대기**), the ack instead waits for your listener's returned promise — see §1 the ack contract. |
| `reset` | `(cmd)` | auto | **장치 리셋** / **모든 장치 리셋** — return to your initial state (stop playback, clear the screen). |
| `progress` | `(p)` | — | `{ commandId, lineIndex, waiting }` — dialogue line sync relayed from the speaker (screen role), or the go-ahead ending a line-cue hold (speaker role). §6.3. |
| `sessionState` | `(s)` | — | `{ sessionId, themeId, mode, phaseId, state, verdict, timerState, timerRemainingMs }`. `state`: `created \| running \| paused \| ended`. Broadcast on every change — pause/resume, phase switches, timer adjustments, verdict. Tick the timer locally while `timerState === 'running'` (no per-second broadcasts); or just use `getRemainingTime()`. |
| `status` | `(status, detail?)` | — | Connection lifecycle — §3. |
| `hint` | `(hint)` | — | `{ hintId, code, step, stepCount, textHtml, imageUrl }` — reply to `submitHint`/`requestHintStep` or an operator push. Mirrored to every socket of the hint device. |
| `hintError` | `(err)` | — | `{ reason, code?, hintId? }`; `reason`: `unknown_code \| unknown_hint \| invalid_step \| not_hint_device \| session_not_running`. |
| `hintCode` | `(cmd)` | auto | **힌트 코드 표시/숨김**: show the entry-code overlay (`cmd.code` set, styled by `cmd.css`, plus the hint asset's `cmd.params`) or hide it (`cmd.code === null`). One code at a time — a newer show replaces the previous. |

---

## 6. Playing media

The library does not play anything. Every `play` wire carries `id`, `playerId`, `assetId`, `assetName`, and media fields with this invariant: `fileKey === null ⇔ url === null ⇔ durationMs !== null`. Null media = **placeholder** (fileless) asset — show a placeholder (use `assetName`), simulate for `durationMs`, then `done()` as usual.

```ts
rk.on('play', (cmd, done) => {
  switch (cmd.channel) {
    case 'bgm':      /* §6.1 */ break;
    case 'sfx':      /* §6.2 */ break;
    case 'dialogue': /* §6.3 */ break;
    case 'video':    /* §6.4 */ break;
  }
});
```

Channels mix: BGM, SFX, and dialogue voice play simultaneously (one active track per channel per player).

### 6.1 `bgm`

Extra fields: `loop`, `fadeInMs`, `fadeOutMs` (from the BGM asset). Ramp volume from 0 over `fadeInMs` on start; **store `fadeOutMs`** and apply it when the track is later stopped or replaced (crossfade). Looping BGM never "ends" — call `done()` on playback *start* (placeholders too).

### 6.2 `sfx`

Extra field: `bgmDuck?` — a 0..1 BGM volume factor (from the player asset's 효과음 중 BGM 볼륨) to apply on this player while the SFX plays; absent = no ducking. Restore BGM volume when the SFX finishes. Call `done()` on end (SFX is usually not waited, but the command supports it).

### 6.3 `dialogue`

Extra fields: `role` (`'speaker' | 'screen' | 'both'` — which half of the player asset this device is; `'both'` when speaker === screen), `lines`, `subtitleCss`, `keepSubtitleAfterEnd`, `params`, `bgmDuck?` (대사 중 BGM 볼륨; meaningful on the speaker side, where BGM plays).

Each line: `{ lineId, fileKey, url, durationMs, subtitleHtml, holdBefore }` (per-line placeholder media possible).

- **Speaker**: play the lines' audio in order, calling `sendProgress(cmd.id, i)` as each line starts. For a line with `holdBefore: true`, *pause before it* and send `sendProgress(cmd.id, i, true)` instead — the server runs the authored 라인 사이 커맨드 sequence, then answers with a plain `progress` for the same `commandId`/`lineIndex`; resume with that line on receipt. Call `done()` after the last line ends (the speaker's ack ends playback; a waited 대사 재생 spans cue time too).
- **Screen**: render `lines[p.lineIndex].subtitleHtml` (styled by `subtitleCss`) on each `progress` event; ignore `holdBefore` (the previous subtitle stays up during a hold). Clear the subtitle at the end unless `keepSubtitleAfterEnd`; also clear on `stop`. Call `done()` immediately — the server waits on the *speaker's* ack.
- **Both**: do both locally; `sendProgress` is still required for line-cue holds (the go-ahead comes back over `progress`).

### 6.4 `video`

Extra fields: `frame` (placement rect `{ x, y, width, height }` in percent of the screen, or `null` = fullscreen) and `params` (video asset's 파라미터 (JSON)). Call `done()` when playback ends.

---

## 7. Recipes

**Node prop controller (GPIO → trigger, message → relay):**

```ts
const rk = new RoomKitClient({ serverUrl, deviceCode: 'door-lock', retryOnFatalError: true });
rk.connect();
button.on('press', () => rk.trigger('big-red-button'));
rk.on('message', (payload, cmd) => {
  if (cmd.messageName === 'set-lock') relay.set(payload.locked === true);
});
rk.on('reset', () => relay.set(true));
```

No storage exists in Node, so `persistTestCode` is effectively off (no-op store) — test codes just go in `deviceCode`.

**Standalone kiosk page (screen-only player half):**

```ts
const rk = new RoomKitClient({ serverUrl, deviceCode: code, retryOnFatalError: true });
rk.connect();
let dlg = null;
rk.on('play', (cmd, done) => {
  if (cmd.channel !== 'dialogue') return done();
  dlg = cmd; done();                       // screen role: speaker's ack gates the sequence
});
rk.on('progress', (p) => {
  if (dlg?.id === p.commandId) subtitleEl.innerHTML = dlg.lines[p.lineIndex].subtitleHtml;
});
rk.on('stop', () => { dlg = null; subtitleEl.innerHTML = ''; });
rk.on('navigate', (url, cmd, done) => { done(); location.href = url; });
rk.on('reset', () => location.reload());
```

---

## 8. Troubleshooting

- **Status `error` with `invalid_code`** — the code matches no device asset (production) or no live test session. Turn on `retryOnFatalError` for devices that boot early.
- **Two clients attach as the same device** — both preferred the same stored test code from a shared origin. Set `persistTestCode: false` or give each its own `storage`.
- **Waited sequences never advance** — a `play`/`navigate` handler dropped its `done`. Every emitted `done` must eventually be called (or the server times the ack out after 15 minutes).
- **Subtitles out of sync** — the speaker isn't calling `sendProgress` per line, or the screen renders on `play` instead of `progress`.
- **Dialogue stalls mid-way at a specific line** — the line has `holdBefore: true` and the speaker never sent `sendProgress(id, i, true)`, so the server never ran the cue and never sent the go-ahead.
- **`fetchAssetManifest` rejects with `no manifest available`** — the socket has no theme yet (mid-reattach); retry after the next `welcome`.
- **Timer looks frozen** — that's correct while `timerState` is `'paused'`; check `sessionState`.
