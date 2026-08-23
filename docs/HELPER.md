# @roomkit/helper — Website Integration Reference

`@roomkit/helper` is the bridge for websites shown **inside the RoomKit Player's iframe** (navigated to by the **웹사이트 이동** command). It talks to the Player exclusively over `postMessage` — it never opens a server connection of its own; every trigger, hint, and payload rides the Player's existing device socket.

> **Helper or client?** If your page runs inside the Player's iframe, use the helper. If it runs standalone (a regular browser tab, its own kiosk machine), it *is* a device: register a 장치 asset and use [`@roomkit/client`](./CLIENT.md) instead. Outside the Player the helper is inert — its messages go nowhere, silently, and its promises reject on timeout.

For the authoring-side picture (websites as assets, commands, the 웹 테스트 workspace) see [MANUAL.md §6](./MANUAL.md). This document is the complete API and protocol reference.

---

## 1. Getting the helper into your page

Two ways:

**Script embed (any site).** Build once and copy the bundle:

```sh
pnpm --filter @roomkit/helper build
# → packages/helper/dist/roomkit-helper.global.js
```

It is a self-contained ~5 KB IIFE (no dependencies — it deliberately bundles no zod) that defines the `RoomKitHelper` global:

```html
<script src="./roomkit-helper.global.js"></script>
<script>
  const rk = new RoomKitHelper();
</script>
```

**Package import (workspace sites).** For a site developed inside this monorepo:

```ts
import { RoomKitHelper } from '@roomkit/helper';
```

The package (ESM + CJS + types) also re-exports the payload types: `RoomKitHelperOptions`, `RoomKitHelperEvents`, `TriggerAndWaitOptions`, `HelperRenderClaims`, `HintShow`, `HintError`, `PlayerSubtitle`, `PlayerHintCode`, `PlayerVideoPlay`, `PlayerVideoStop`, `PlayerMessage`.

---

## 2. Lifecycle

### 2.1 The hello handshake

Constructing a `RoomKitHelper` immediately posts a `hello` to `window.parent`, carrying the page's render claims (§5). Because the page's script can run before the Player's bridge is listening (or a reload can race it), the hello is **repeated every 800 ms, up to 25 times**, until any Player message proves the bridge heard it — the Player replies `mode` to every hello, so one round-trip normally settles it. A page opened outside the Player just goes quiet after the retries.

On the Player side, all outbound messages are **buffered until the hello arrives**, so a late-loading page misses nothing: pending subtitles, hint state, and message payloads are flushed the moment the handshake lands.

### 2.2 Navigation resets claims

Render claims live in the hello and **die with the page**: every page (or reload) re-declares its claims in its own constructor. A page that claims nothing restores the Player's default overlay rendering. On claiming, the *current* state (e.g. a subtitle already on screen) is delivered immediately.

### 2.3 destroy()

`destroy()` unregisters the message listener, reverts the lockdown (§3), resolves any pending `getRemainingTime()` calls with `null`, and **rejects** any pending `triggerAndWait()` calls (`helper destroyed`) — a destroyed wait cannot claim the event runs finished. The instance is dead afterwards; construct a new one if needed.

---

## 3. Constructor options

```ts
new RoomKitHelper({
  lockdown?: boolean,                       // default true
  renders?: { subtitle?: boolean, hintCode?: boolean, video?: boolean },
});
```

| Option | Default | Meaning |
|---|---|---|
| `lockdown` | `true` | Apply the Player's kiosk defaults inside the iframe: text selection disabled document-wide via an injected stylesheet (`input`/`textarea` stay selectable) and the context menu suppressed. The context-menu block is **mode-aware**: in a test session (`sessionMode === 'test'`) right-click stays available so devtools remain reachable. Set `false` while developing the page in a normal browser; `destroy()` reverts everything. |
| `renders` | all `false` | Rendering slots this page takes over from the Player — see §5. Unclaimed slots keep the Player's default overlays. |

(`parentWindow` / `selfWindow` also exist as test seams — they default to `window.parent` / `window` and are not needed in real pages.)

### `sessionMode` getter

```ts
rk.sessionMode; // 'production' | 'test'
```

The session mode as reported by the Player (replied to every hello). Defaults to `'production'` until told otherwise. Useful for showing debug UI only during test sessions.

---

## 4. Methods

### `trigger(event, payload?)` → void

Report a game event through the Player's device connection. Fires every **장치 트리거** event whose 트리거 이름 matches `event` (subject to the session's current phase). `payload` is any JSON value, exposed to sequences as `{{payload.…}}` templates and `ctx.payload` in eval commands.

```ts
rk.trigger('door-open');
rk.trigger('keypad', { digits: '0417' });
```

Fire-and-forget: no reply, no error when nothing matches (the miss is logged server-side).

### `triggerAndWait(event, payload?, options?)` → Promise\<void\>

Same report, but resolves once the server has **completely finished every event run the trigger started** (immediately when nothing listened). The Player relays the server's socket.io trigger ack back as a `trigger:result`.

- A command *failing* inside a run does not reject — the run still finishes and the promise resolves.
- Rejects when the Player reports the wait failed (device offline, or a server predating trigger acks) or when no reply arrives within `options.timeoutMs` (default **600 000 ms** = 10 min — event runs can legitimately contain long waits and videos). A timeout does not cancel the runs; they continue server-side.
- Outside the Player it rejects on timeout.

```ts
await rk.triggerAndWait('door-open');
await rk.triggerAndWait('door-open', null, { timeoutMs: 30_000 });
```

### `submitHint(code)` → void

Hint-device only: submit the code the team typed. The result arrives as a `hint` event (step 0 of the matched hint) or a `hintError` event. No-op consequences on non-hint devices surface as `hintError { reason: 'not_hint_device' }`.

### `requestHintStep(hintId, step)` → void

Stateless step navigation: request the exact 0-based step to display for an already-shown hint (`hintId` from the `hint` event). The server validates bounds (`invalid_step`) — so "next" is simply `requestHintStep(h.hintId, h.step + 1)` and "previous" is `h.step - 1`. When the hint has an explicit answer (`h.hasAnswer`), requesting step `h.stepCount` reveals it (`isAnswer: true` in the reply).

### `getRemainingTime(options?)` → Promise\<number | null\>

Remaining countdown milliseconds via the Player: ticking while running, frozen while paused, `0` when expired, `null` when the theme has no timer. Options:

- `resync` (default `false`) — ask the Player to refresh its session-state snapshot from the server first (best effort; falls back to its local value).
- `timeoutMs` (default `10_000`) — rejects when the Player doesn't answer (e.g. the page runs outside the Player).

During a 웹 테스트 run this returns the simulated timer from the workspace's 타이머 card.

### `videoEnded(commandId)` / `videoError(commandId)` → void

Only meaningful with a claimed `video` slot (§5.3): report that the delegated playback finished (acks the play command — this is what unblocks a waited **비디오 재생**) or failed (acks it as failed; the sequence continues either way).

### `on(event, listener)` / `off(event, listener)` → this

Subscribe/unsubscribe; chainable. Events in §6.

### `destroy()` → void

See §2.3.

---

## 5. Render claims

By default the Player renders subtitles, the hint-code overlay, and video itself, around your iframe. Pass `renders` to take slots over — each independently:

```ts
const rk = new RoomKitHelper({
  renders: { subtitle: true, hintCode: true, video: false },
});
```

For every claimed slot the Player suppresses its own rendering and forwards the data instead. Each payload carries the same authoring inputs the default overlay uses — the authored CSS and the asset's **파라미터 (JSON)** — and the site decides how (or whether) to apply them. `css`/`params` are forwarded verbatim (trusted admin input, like subtitle HTML).

### 5.1 `subtitle`

Fired per dialogue line; `null` clears the subtitle (also fired when the dialogue ends without 재생 후 자막 유지).

```ts
rk.on('subtitle', (s) => {
  // s: { html, css, params, lineIndex, lineCount } | null
  subtitleEl.innerHTML = s ? s.html : '';
});
```

- `html` — the line's 자막 HTML.
- `css` — the player asset's 자막 CSS.
- `params` — the dialogue asset's 파라미터 (JSON) (`Record<string, JsonValue>`).
- `lineIndex` / `lineCount` — 0-based position, for progress displays.

### 5.2 `hintCode`

The current entry code to display; `null` hides it. One code at a time — a newer show replaces the previous.

```ts
rk.on('hintCode', (h) => {
  // h: { code, css, params } | null
  codeEl.textContent = h ? h.code : '';
});
```

`css` is the *device* asset's 힌트 코드 CSS; `params` is the *hint* asset's 파라미터 (JSON).

### 5.3 `video` — a contract

Claiming `video` means **the site plays the media itself, audio included**; the Player renders no video element at all.

```ts
rk.on('videoPlay', (v) => {
  // v: { commandId, assetName, url, durationMs, frame, params }
  video.src = v.url;
  video.onended = () => rk.videoEnded(v.commandId);
  video.onerror = () => rk.videoError(v.commandId);
  video.play();
});
rk.on('videoStop', ({ commandId }) => video.pause());
```

- The **비디오 재생** command's ack waits for your `videoEnded(commandId)` (or `videoError`). Forgetting it stalls every `끝날 때까지 대기` sequence on that video — the test overlay's skip button is the escape hatch.
- **Placeholder** (fileless) videos: `url` is `null` and `durationMs` is set; the Player acks on its own duration timer, so the site only needs to render a placeholder (using `assetName` if it likes) — no `videoEnded` required.
- `url` is a same-origin `blob:` URL when the Player has the file in its local media cache (the bytes arrive with the message and the helper mints the URL — an https site cannot load the Player's loopback server directly, WebKit blocks that as mixed content), otherwise the time-limited presigned URL. Either way, assign it to `video.src` as-is. The blob URL is revoked when the next `videoPlay`/`videoStop` arrives, so don't stash it for later.
- `frame` is the authored placement rect (`{ x, y, width, height }` in percent) or `null` for fullscreen — the site may honor or ignore it.
- `videoStop` arrives on a server stop command, a replacement play, or a test-overlay skip.

---

## 6. Events

| Event | Listener args | When |
|---|---|---|
| `message` | `(payload, envelope)` | A **메시지 전송** command reached this device. `payload` is `Record<string, JsonValue>` keyed by the message asset's field keys; `envelope.messageId` / `envelope.messageName` identify the message asset. Listeners may return a promise: when the command was authored with **끝날 때까지 대기**, the server sequence waits until every listener's promise settles (a rejection fails the command's ack; the sequence still continues). |
| `hint` | `(hint)` | A hint step to render — the reply to `submitHint`/`requestHintStep`, or an operator push from the 힌트 전송 card. `hint: { hintId, code, step, stepCount, hasAnswer, isAnswer, textHtml, imageUrl }` (`imageUrl` null when the step has no image; presigned, time-limited). |
| `hintError` | `(err)` | A hint request was rejected. `err.reason`: `unknown_code` (submit matched nothing; `err.code` echoes it), `unknown_hint` / `invalid_step` (bad `requestHintStep`), `not_hint_device`, `session_not_running` (paused, ended, or not live). |
| `subtitle` | `(s \| null)` | Claimed subtitle slot only — §5.1. |
| `hintCode` | `(h \| null)` | Claimed hintCode slot only — §5.2. |
| `videoPlay` | `(v)` | Claimed video slot only — §5.3. |
| `videoStop` | `({ commandId })` | Claimed video slot only — stop the delegated playback. |

Unknown Player messages are ignored (forward compatibility); malformed ones are dropped.

---

## 7. Wire format (postMessage envelopes)

Schemas live in `packages/shared/src/helper.ts` (`HelperToPlayerSchema` / `PlayerToHelperSchema`). The helper posts to `window.parent` with `targetOrigin: '*'` (it cannot know the Player's Tauri origin; being embedded by the Player is the trust anchor). The Player targets the navigated site's origin, verifies `event.source === iframe.contentWindow` on inbound messages, and zod-validates them; the helper checks inbound envelopes structurally to stay dependency-free.

**helper → player** (`source: 'roomkit-helper'`): `hello { renders }`, `trigger { event, payload?, requestId? }` (`requestId` set = awaited, §4), `hint:submit { code }`, `hint:next { hintId, step }`, `timer:get { requestId, resync }`, `video:ended { commandId }`, `video:error { commandId }`, `message:done { commandId, ok }` (answers an awaited `message` once the page's handlers settle).

**player → helper** (`source: 'roomkit-player'`): `message` (carries a `commandId` only when the command awaits handling — the helper answers with `message:done`), `hint:show { hint }`, `hint:error { error }`, `timer { requestId, remainingMs }`, `trigger:result { requestId, ok }`, `subtitle { subtitle | null }`, `hintCode { hintCode | null }`, `video:play`, `video:stop { commandId }`, `mode { mode }`.

---

## 8. Developing and testing a page

- Develop in a normal browser with `new RoomKitHelper({ lockdown: false })`; everything else no-ops harmlessly (async calls reject on timeout).
- For a live loop against a real Player, use Studio's **웹 테스트** workspace ([MANUAL.md §6.5](./MANUAL.md)): point it at your dev server (`localhost:5173`, HMR works — the Player's bridge survives iframe reloads and re-handshakes on each), fire commands/events at the page, watch its triggers in the 활동 로그, and drive `getRemainingTime()` with the simulated timer. Triggers are reported, never executed.
- Register the finished site as a 웹사이트 asset (외부 URL or ZIP 호스팅) and target it with **웹사이트 이동** — see MANUAL.md §6.4.

## 9. Troubleshooting

- **No events arrive** — the page probably isn't inside the Player's iframe (open it via a 웹사이트 이동 command or a 웹 테스트 run), or `destroy()` was called. The hello retry gives up after ~20 s.
- **`triggerAndWait` rejects with `trigger failed`** — the Player's device socket was offline when the trigger was sent, or the server predates trigger acks.
- **Waited video sequences hang** — the page claimed `video` but never called `videoEnded(commandId)`. Wire `onended`/`onerror` before `play()`.
- **Right-click works in the room** — expected in test sessions only; production sessions suppress it. Check `rk.sessionMode`.
- **Stale subtitle after navigation** — claims reset per page; if the new page claims `subtitle`, the current state is re-delivered on its hello, and rendering it is the page's job.
