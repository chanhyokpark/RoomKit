# `@roomkit/helper` Integration Contract

[AI documentation index](../TOC_AI.md) · [React example](../../templates/web/README.md) · [Svelte example](../../templates/web_svelte/README.md)

Use Helper only for a website navigated inside RoomKit Player's iframe. It does not connect to the RoomKit server. All traffic is `postMessage` through Player's existing device socket. A standalone browser/device must use [`@roomkit/client`](./client.md).

## Installation

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper"
```

pnpm 10 consumers must first allow the package's build script; see [library installation from GitHub](./environment.md#library-installation-from-github).

## Framework wrappers (recommended for React/Svelte)

React and Svelte 5 sites should use the wrapper packages instead of constructing `RoomKitHelper` by hand:

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper-react"
# or
pnpm add "github:chanhyokpark/RoomKit#path:packages/helper-svelte"
```

Initialize the wrapper once at the TOP layout — the component that never unmounts (React: the root component rendered in `main.tsx`; SvelteKit: the root `+layout.svelte`). Options are read once on mount, and a remount or document navigation re-runs the hello handshake and drops render claims, so nothing below the top layout should own the helper. `options` are the `RoomKitHelper` constructor options (`renders`, `messages`, `testCallbacks`, `lockdown`) plus `timerPollMs`.

Both wrappers expose one `rk` surface (`RoomKitApi`):

- Reactive values: `rk.bridge` (`connecting`/`connected`/`timeout`), `rk.outsidePlayer` (render a warning when true), `rk.sessionMode`, `rk.remainingMs` (auto-updating timer — polls the player's local snapshot every second; `timerPollMs` tunes/disables it), and the claimed `rk.subtitle`/`rk.hintCode`/`rk.video` slot values.
- Hint facade `rk.hint`: `data` (current step/answer), `error`, `pending`, `hasPrev`/`hasNext`/`nextIsAnswer`, `counts` (usage stats), and actions `submit(code)`/`prev()`/`next()`/`showAnswer()`/`dismiss()`/`resetCounts()`.
- Actions: `rk.trigger(event, payload?)`, `rk.refreshTimer()`, `rk.videoEnded/videoError(commandId)`, `rk.triggerAndWait(...)` (not recommended, see above), and `rk.helper` as the raw escape hatch.

Svelte — `getRoomKit()` returns a per-component view; values are rune-backed (observe with `$effect`/templates), and callback registrations are scoped to the instance and auto-removed when the component is destroyed (`rk.destroy()` does the same manually without touching other components):

```svelte
<script lang="ts">
  import { getRoomKit, HintInput, HintRenderer } from '@roomkit/helper-svelte';
  const rk = getRoomKit();
  rk.onMessage('set-screen', (payload) => applyScreen(payload)); // or rk.onMessage(cb) for all
  rk.onHintUpdate((hint) => playChime(hint));                    // also on/onHintError
</script>
남은 시간 {Math.ceil((rk.remainingMs ?? 0) / 1000)}초 · 힌트 {rk.hint.counts.hintsUsed}개
<HintInput hint={rk.hint} />
<HintRenderer hint={rk.hint} />
```

React — `useRoomKit()` returns the same surface; callbacks are effect-scoped hooks:

```tsx
const rk = useRoomKit();
useRoomKitMessage('set-screen', (payload) => applyScreen(payload)); // or useRoomKitMessage(cb)
useRoomKitEvent('hint', (hint) => playChime(hint)); // any helper event
return <HintRenderer hint={rk.hint} />;
```

`HintInput`/`HintRenderer` accept the `hint` facade as a prop and fall back to the ambient context when omitted. Message handlers may return promises — awaited (waitUntilEnd) message commands ack only after they settle.

The wrappers supersede the deprecated `@roomkit/hintphone-react`/`@roomkit/hintphone-svelte` and drop their client mode — a hintphone outside Player is a standalone device on [`@roomkit/client`](./client.md). Executable examples: [`templates/web`](../../templates/web/README.md) (Vite + React + Tailwind) and [`templates/web_svelte`](../../templates/web_svelte/README.md) (SvelteKit static adapter).

## Construction and handshake

```ts
const helper = new RoomKitHelper({
  lockdown: true,
  renders: { subtitle: true, hintCode: false, video: true },
  // Declared names, listed in the player's debug window; delivery is not
  // filtered by this list.
  messages: ["set-screen"],
  testCallbacks: {
    "flash-panel": () => flashPanel(),
  },
});
helper.on("message", (payload, envelope) => {
  if (envelope.messageName === "set-screen") return updateScreen(payload);
});
```

Construction installs a message listener, optional kiosk lockdown, and emits `hello` with render claims, helper version, and the registered `messages`/`testCallbacks` names. Hello repeats every 800 ms up to 25 times until a Player message proves the bridge is alive. Player buffers state until hello, so a late page receives the current subtitle/hint/video-related state.

Navigation destroys claims. Every new document must construct Helper again. `destroy()` removes listeners/styles, rejects pending trigger waits, resolves pending timer requests with null, and permanently retires the instance.

## General API

- `trigger(event, payload?)` reports a JSON trigger without a response.
- `triggerAndWait(event, payload?, { timeoutMs? })` resolves after all event runs started by that trigger finish. Not recommended: it inverts the server-centric flow (the site starts waiting on server logic) and stalls up to the timeout when runs are long or the page reloads mid-wait. Prefer plain `trigger` and let a server-sent message drive the site's next state; reserve triggerAndWait for genuinely synchronous UI (e.g. disabling a button until a short run completes). Default timeout is ten minutes; timeout does not cancel server runs.
- `submitHint(code)` and `requestHintStep(hintId, step)` implement hint navigation. The resulting `hint` event payload includes the hint asset's free-form `params` for custom rendering.
- `getRemainingTime({ resync?, timeoutMs? })` requests Player's timer snapshot. It rejects when no Player answers.
- `sessionMode` is `production` until Player reports `test` or `production`.
- `bridgeState` is `connecting` until any Player message arrives (`connected`), or `timeout` once every hello retry went unanswered (~20s) — the page was opened outside Player.
- `on`/`off` subscribe to `message`, hint events, claimed render slots, and `bridge`/`mode` state changes.

Handle messages with `on('message')`, dispatching on `envelope.messageName` — multi-page sites can register per page instead of pre-registering everything. The `messages` option is a plain name array whose only job is surfacing those names in the debug window's per-device panel; it never filters delivery. Awaited send-message commands carry a command ID. Helper waits for every message listener's returned promise and posts `message:done`; one rejection marks handling failed but does not stop the server sequence.

## Test callbacks

`testCallbacks` registers parameterless functions runnable from the Player debug window in test sessions only. Player sends `test:callback` with a request ID; Helper runs the callback, awaits a returned promise, and answers `test:callback:done` with ok/failed. The server times the invocation out after fifteen seconds. Use them for repeatable manual probes (reset local state, simulate a puzzle solve) without wiring temporary UI.

## Render claims

Claims are independent. An unclaimed slot remains Player-rendered.

### Subtitle

`subtitle` emits `{ html, css, params, lineIndex, lineCount } | null`. Null clears. HTML, CSS, and params are trusted admin input. Maintain one current style element and remove it on clear/replacement to avoid accumulating authored CSS.

### Hint code

`hintCode` emits `{ code, css, params } | null`. A newer code replaces the old display. This is the entry-code overlay, not a revealed hint step.

### Video

`videoPlay` emits `{ commandId, assetName, url, durationMs, frame, params }`. Claiming video delegates playback including audio. For file-backed media:

1. apply the frame/params;
2. start playback;
3. call `videoEnded(commandId)` on natural completion;
4. call `videoError(commandId)` on load or play failure.

`videoStop` means pause and clear the active command. New playback replaces the previous command. Use the delivered URL exactly; it may be a presigned URL or a Helper-created blob URL. Do not retain it after replacement/stop.

For `url: null`, render a placeholder from `assetName`/`durationMs`. Player owns the completion timer; do not call `videoEnded`. Forgetting an end/error for a real video stalls waited sequences.

## Lockdown and local development

Lockdown disables text selection outside form fields and blocks the context menu in production sessions. Test sessions retain context-menu access. Set `lockdown: false` for plain-browser development, but remember Helper has no functional transport outside Player.

For live development, launch a player test session from Player's test tab with a website URL override pointing at your Vite dev server. For ZIP deployment use relative asset paths and `index.html` at archive root.

## API reference

Complete public surface, kept in sync with the shipped types — no SDK source lookup needed. Declaration-style TypeScript; comments carry defaults and semantics.

### Shared payload types

```ts
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type SessionMode = 'test' | 'production';

/** A hint step or answer to render. */
interface HintShow {
  hintId: string;                    // uuid
  code: string;                      // theme-unique hint code (also set on admin pushes)
  step: number;                      // 0-based; equals stepCount when isAnswer
  stepCount: number;
  hasAnswer: boolean;                // explicit answer exists, requestable as step `stepCount`
  isAnswer: boolean;                 // this payload IS the explicit answer
  textHtml: string;                  // trusted admin HTML
  imageUrl: string | null;
  params: Record<string, JsonValue>; // hint asset's free-form params
}

type HintErrorReason =
  | 'unknown_code'          // submitHint: code matched no hint
  | 'unknown_hint'          // requestHintStep: hintId not in this theme
  | 'invalid_step'          // requestHintStep: step out of range
  | 'not_hint_device'       // device asset not flagged isHintDevice
  | 'session_not_running';  // session paused, ended, or not live

interface HintError {
  reason: HintErrorReason;
  code?: string;            // echo of the submitted code (unknown_code only)
  hintId?: string;
}

/** Envelope delivered with every relayed message. */
interface PlayerMessage {
  source: 'roomkit-player';
  type: 'message';
  messageId: string;
  messageName: string;               // message asset name — dispatch on this
  payload: Record<string, JsonValue>;
  commandId?: string;                // present when the command awaits handling
}

interface HelperRenderClaims { subtitle: boolean; hintCode: boolean; video: boolean }

/** 'subtitle' event payload (claimed slot). Null = clear the overlay. */
type SubtitleState = {
  html: string;                      // line subtitle HTML (trusted admin input)
  css: string;                       // player asset's subtitleCss
  params: Record<string, JsonValue>; // dialogue asset's free-form params
  lineIndex: number;                 // 0-based
  lineCount: number;
} | null;

/** 'hintCode' event payload (claimed slot). Null = hide the code. */
type HintCodeState = {
  code: string;
  css: string;                       // device asset's hintCodeCss
  params: Record<string, JsonValue>; // hint asset's free-form params
} | null;

/** Authored stage placement, percent of the stage; null = fullscreen. */
interface VideoFrame { x: number; y: number; width: number; height: number }

/**
 * 'videoPlay' event payload (claimed slot). Doc shorthand — `@roomkit/helper`
 * types it inline as `Omit<PlayerVideoPlay, 'source' | 'type'>`; the wrapper
 * packages export it (nullable) as `VideoState`. `SubtitleState`/`HintCodeState`
 * are likewise exported by the wrappers (helper types them as
 * `PlayerSubtitle['subtitle']` / `PlayerHintCode['hintCode']`).
 */
interface DelegatedVideo {
  commandId: string;                 // echo it in videoEnded()/videoError()
  assetName: string;
  url: string | null;                // media URL (possibly a helper-minted blob:); null = fileless placeholder
  durationMs: number | null;         // set exactly when url is null
  frame: VideoFrame | null;
  params: Record<string, JsonValue>; // video asset's free-form params
}
```

### `@roomkit/helper`

```ts
type HelperBridgeState = 'connecting' | 'connected' | 'timeout';
/** 'message' listener shape; a returned promise defers the awaited ack. */
type MessageHandler = (payload: Record<string, JsonValue>, envelope: PlayerMessage) => void | Promise<unknown>;
type TestCallback = () => void | Promise<void>;

interface RoomKitHelperOptions {
  lockdown?: boolean;                           // default true; false for plain-browser dev
  renders?: Partial<HelperRenderClaims>;        // slots this site renders itself; default all false
  messages?: string[];                          // declared names for the debug window (never filters delivery)
  testCallbacks?: Record<string, TestCallback>; // debug-window callbacks (test sessions only)
  parentWindow?: Pick<Window, 'postMessage'>;                            // test seam
  selfWindow?: Pick<Window, 'addEventListener' | 'removeEventListener'>; // test seam
}

interface TriggerAndWaitOptions { timeoutMs?: number }                     // default 600000
interface GetRemainingTimeOptions { resync?: boolean; timeoutMs?: number } // defaults false / 10000

interface RoomKitHelperEvents {
  message: [Record<string, JsonValue>, PlayerMessage];
  hint: [HintShow];                   // reply to submitHint/requestHintStep, or an operator push
  hintError: [HintError];
  subtitle: [SubtitleState];          // claimed subtitle slot only
  hintCode: [HintCodeState];          // claimed hintCode slot only
  videoPlay: [DelegatedVideo];        // claimed video slot only
  videoStop: [{ commandId: string }]; // claimed video slot only
  bridge: [HelperBridgeState];        // emitted on change
  mode: [SessionMode];                // emitted on change
}

class RoomKitHelper {
  /** Installs the message listener + lockdown and posts hello (retries ~20s). */
  constructor(options?: RoomKitHelperOptions);
  get sessionMode(): SessionMode;         // 'production' until the player reports
  get bridgeState(): HelperBridgeState;   // 'timeout' = page runs outside the player
  trigger(event: string, payload?: JsonValue): void;
  /** Not recommended (see General API). Rejects on timeout or bridge-less page. */
  triggerAndWait(event: string, payload?: JsonValue, options?: TriggerAndWaitOptions): Promise<void>;
  submitHint(code: string): void;                       // reply arrives as 'hint' / 'hintError'
  requestHintStep(hintId: string, step: number): void;  // step `stepCount` = explicit answer
  /** Rejects when no player answers within timeoutMs. */
  getRemainingTime(options?: GetRemainingTimeOptions): Promise<number | null>;
  videoEnded(commandId: string): void;   // delegated video finished (acks the play)
  videoError(commandId: string): void;   // delegated video failed (play fails over)
  on<K extends keyof RoomKitHelperEvents>(event: K, listener: (...args: RoomKitHelperEvents[K]) => void): this;
  off<K extends keyof RoomKitHelperEvents>(event: K, listener: (...args: RoomKitHelperEvents[K]) => void): this;
  /** Terminal: removes listeners/lockdown, rejects pending trigger waits, resolves pending timer gets with null. */
  destroy(): void;
}

const HELPER_VERSION: string; // bundle version reported in the hello
```

### Wrapper shared surface (`@roomkit/helper-react` and `@roomkit/helper-svelte`)

Both wrapper packages re-export every type above plus the following. Consumers install only the wrapper — helper and the hint controller are bundled.

```ts
interface RoomKitOptions extends RoomKitHelperOptions {
  timerPollMs?: number | false; // remainingMs poll interval; default 1000, false disables
}

type VideoState = DelegatedVideo | null; // exported name for the video slot value

interface HintCounterStats {
  hintsUsed: number;     // distinct hints shown (code entry or push)
  stepsViewed: number;   // distinct (hint, step) pairs; the answer counts as a step
  totalShows: number;    // repeats included
  answersOpened: number; // distinct explicit answers revealed
  wrongCodes: number;    // unknown_code submissions
}

/** Hint navigation facade — feed to <HintInput>/<HintRenderer> via their `hint` prop. */
interface RoomKitHintApi {
  readonly data: HintShow | null;   // current step/answer; null = idle
  readonly error: HintError | null; // cleared by the next successful show/submit
  readonly pending: boolean;        // a submit/step request is in flight (auto-clears after 10s without a reply)
  readonly hasPrev: boolean;
  readonly hasNext: boolean;        // includes revealing the answer
  readonly nextIsAnswer: boolean;   // next() reveals the explicit answer
  readonly counts: HintCounterStats;
  submit(code: string): void;       // trims; empty codes are ignored
  prev(): void;                     // from the answer: back to the last step
  next(): void;                     // on the last step: reveals the answer (when hasAnswer)
  showAnswer(): void;               // no-op without an explicit answer
  dismiss(): void;                  // clear hint + error (back to idle)
  resetCounts(): void;
}

/** The `rk` surface returned by useRoomKit() (React) / getRoomKit() (Svelte). */
interface RoomKitApi {
  readonly bridge: HelperBridgeState;
  readonly sessionMode: SessionMode;
  readonly remainingMs: number | null;   // auto-updating timer; null = no timer / not known yet
  readonly outsidePlayer: boolean;       // bridge timeout OR page not iframed — render a warning
  readonly subtitle: SubtitleState;      // always null when the slot is unclaimed
  readonly hintCode: HintCodeState;
  readonly video: VideoState;
  readonly helper: RoomKitHelper | null; // raw escape hatch; null before the provider/setup mounted
  readonly hint: RoomKitHintApi;
  trigger(event: string, payload?: JsonValue): void;
  /** Not recommended; rejects before mount. */
  triggerAndWait(event: string, payload?: JsonValue, options?: TriggerAndWaitOptions): Promise<void>;
  /** Force-refresh remainingMs; default options = { resync: true }. Resolves with the last known value on failure. */
  refreshTimer(options?: GetRemainingTimeOptions): Promise<number | null>;
  videoEnded(commandId: string): void;
  videoError(commandId: string): void;
}

/** Also exported (advanced; app code rarely needs them). */
function isOutsidePlayer(bridge: HelperBridgeState): boolean;
interface RoomKitSnapshot { /* immutable merged state behind RoomKitApi: bridge, sessionMode,
  remainingMs, hintCounts, subtitle, hintCode, video + hint/error/pending/hasPrev/hasNext/
  nextIsAnswer and connectionState ('connecting' | 'connected' | 'disconnected') */ }
const IDLE_ROOMKIT_SNAPSHOT: RoomKitSnapshot; // served before mount / during SSR
class RoomKitCore { /* owns helper + hint controller/counter; created by the provider/setup */ }
```

### `@roomkit/helper-react`

```tsx
/** Mount ONCE at the top of the app. `options` are read once on mount. */
function RoomKitProvider(props: { options?: RoomKitOptions; children?: ReactNode }): ReactNode;

/** Reactive `rk` surface. Outside a provider (or before mount) it serves idle
 *  values and no-op actions — it never throws. */
function useRoomKit(): RoomKitApi;

/** Effect-scoped subscription to any helper event; auto-unregisters on unmount.
 *  The handler lives in a ref — inline closures are fine, no memoization needed. */
function useRoomKitEvent<K extends keyof RoomKitHelperEvents>(
  event: K,
  handler: (...args: RoomKitHelperEvents[K]) => unknown,
): void;

/** Message subscription. With `name`, only that message asset; without, every
 *  message. A returned promise defers the awaited (waitUntilEnd) ack. */
function useRoomKitMessage(handler: MessageHandler): void;
function useRoomKitMessage(name: string, handler: MessageHandler): void;

/** Headless code entry. All props optional. */
function HintInput(props: {
  hint?: RoomKitHintApi;             // default: context hint facade
  variant?: 'keypad' | 'text';       // default 'keypad'
  maxLength?: number;                // default 8
  onSubmit?: (code: string) => void; // replaces hint.submit
  className?: string;                // root class hook; default 'rk-hint-input'
  labels?: { submit?: string; clear?: string; backspace?: string; placeholder?: string };
}): ReactNode;

/** Headless renderer for the current hint step/answer + errors + navigation. */
function HintRenderer(props: {
  hint?: RoomKitHintApi;             // default: context hint facade
  className?: string;                // root class hook; default 'rk-hint'
  labels?: { prev?: string; next?: string; showAnswer?: string; answer?: string; close?: string };
  errorLabels?: Partial<Record<HintErrorReason, string>>; // merged over Korean defaults
  closable?: boolean;                // default true — dismiss button
  empty?: ReactNode;                 // rendered while no hint and no error
}): ReactNode;
```

### `@roomkit/helper-svelte`

```ts
// <RoomKitSetup options={...}> mounts ONCE at the root +layout.svelte and
// provides context to everything below. Props: { options?: RoomKitOptions; children?: Snippet }.

/** Call during component initialization below <RoomKitSetup> (throws without one).
 *  Returns a fresh per-component view; its callback registrations are removed
 *  automatically when the calling component is destroyed. */
function getRoomKit(): RoomKit;

class RoomKit implements RoomKitApi {
  // All RoomKitApi members. Value getters are rune-backed — reading them in a
  // template, $derived or $effect subscribes to updates (remainingMs ticks on
  // its own). Plus instance-scoped callback registration:

  /** Subscribe to any helper event. Returns an unsubscribe function. */
  on<K extends keyof RoomKitHelperEvents>(event: K, listener: (...args: RoomKitHelperEvents[K]) => unknown): () => void;
  /** Message subscription; with `name`, only that message asset. A returned
   *  promise defers the awaited (waitUntilEnd) ack. */
  onMessage(handler: MessageHandler): () => void;
  onMessage(name: string, handler: MessageHandler): () => void;
  onHintUpdate(handler: (hint: HintShow) => void): () => void;  // 'hint' event
  onHintError(handler: (error: HintError) => void): () => void; // 'hintError' event
  /** Remove every callback registered through THIS instance only. Idempotent;
   *  called automatically on component destroy. */
  destroy(): void;
}

// HintInput / HintRenderer: same props as the React components with `class`
// instead of `className` and `empty?: Snippet` instead of ReactNode.
```
