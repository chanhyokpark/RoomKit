# Hintphone Component Integration

[AI documentation index](../TOC_AI.md) · [React example](../../templates/hintphone/README.md)

> **Deprecated:** `@roomkit/hintphone-react` and `@roomkit/hintphone-svelte` are superseded by the helper wrappers `@roomkit/helper-react`/`@roomkit/helper-svelte` (see [Helper integration](./helper.md#framework-wrappers-recommended-for-reactsvelte)), which carry the same headless hint components plus the full helper API. The wrappers drop client mode — a hintphone running outside Player is a standalone device on [`@roomkit/client`](./client.md). Use the hintphone packages only for existing client-mode sites; they receive no new features.

RoomKit provides transport/controller core plus React and Svelte bindings. The UI packages are headless: they emit semantic DOM and class hooks but do not ship theme styling.

## Installation

```sh
pnpm add "github:chanhyokpark/RoomKit#path:packages/hintphone-react"
# or
pnpm add "github:chanhyokpark/RoomKit#path:packages/hintphone-svelte"
```

Each UI package bundles the controller transport, so no separate core package is installed. pnpm 10 consumers must first allow the package's build script; see [library installation from GitHub](./environment.md#library-installation-from-github).

## Transport selection

`HintphoneConnection` supports:

- `helper`: use `RoomKitHelper` through an enclosing Player; no server URL or code.
- `client`: use `RoomKitClient`; requires server URL and either a configured code or operator-entered code.
- `auto`: default; choose helper inside an iframe and client otherwise.

In client mode without a code, state is `needs-code`. React `HintphoneProvider` and Svelte setup can show a built-in unstyled dialog or a custom dialog. Operator-entered codes are stored by default; explicit `deviceCode` values are never stored.

## React API

`HintphoneProvider` constructs connection/controller once after mount. Its options are intentionally read once to avoid reconnecting on each render. `useHintphone()` returns connection, controller, and a reactive snapshot.

`HintInput` supports keypad or text mode, configurable maximum length, labels, class name, and custom submit. `HintRenderer` shows HTML content, optional image, step navigation, explicit answer, errors, close, and an empty state. Default labels and errors are Korean.

`useHintCounter()` counts unique shown hints, revealed steps, explicit answers, and unknown-code errors for the current browser lifetime.

## Svelte API

`HintphoneSetup` owns the connection/controller and supplies Svelte context. `HintInput` and `HintRenderer` mirror the React behavior and class hooks. `getHintphone()` returns a reactive `HintphoneContext`; it must be called during initialization below a setup component. Construct `new HintCounter()` in the same context to expose reactive `stats` and `reset()`.

Both setup components show a built-in unstyled device-code dialog in client mode when no code is configured, and both accept a custom dialog callback/snippet. Connection options are read once per mount.

## Hint state contract

A successful hint payload contains `hintId`, code, zero-based step, step count, answer flags, trusted HTML, optional image URL, and the hint asset's free-form `params` (same JSON on every step of the hint) for custom rendering. The controller requests exact step numbers; it does not mutate server-side progress. When a hint has an explicit answer, requesting `stepCount` returns `isAnswer: true`.

Error reasons are `unknown_code`, `unknown_hint`, `invalid_step`, `not_hint_device`, and `session_not_running`. Pending UI must clear on both hint and error events.

The attached device must be marked as a hint device. Operator push can display a step without code entry but is still logged as hint usage.

Website-test runs intentionally do not execute the hint service: submissions are logged and return `session_not_running`. Test successful steps, answer navigation, and operator push in a running test session. Hint push and code-overlay controls are available in the shared Studio/Player session dashboard.

## SSR and lifecycle

Before mount and during SSR, UI bindings expose an idle snapshot. Destroy controller/connection on unmount. React Strict Mode may run an effect setup/cleanup probe in development; integrations must not create transport objects during render.

## API reference

Complete public surface, kept in sync with the shipped types — no SDK source lookup needed. `HintShow`, `HintError`, and `HintErrorReason` are identical to the definitions in [Helper integration](./helper.md#api-reference).

### `@roomkit/hintphone-core` (bundled into both UI packages)

```ts
type HintphoneMode = 'client' | 'helper';
type HintphoneConnectionState =
  | 'needs-code'    // client mode without a device code — ask the operator
  | 'connecting' | 'connected' | 'disconnected' | 'error';

interface HintphoneConnectionOptions {
  mode?: HintphoneMode | 'auto'; // default 'auto': helper inside an iframe, client otherwise
  serverUrl?: string;            // required in client mode
  deviceCode?: string;           // client mode; omitted → 'needs-code' until setDeviceCode()
  deviceName?: string;           // handshake label; default 'hintphone'
  persistDeviceCode?: boolean;   // default true; only dialog-entered codes are stored
  lockdown?: boolean;            // helper-mode passthrough (kiosk lockdown)
  debug?: boolean;               // console-log underlying client/helper traffic
}

interface HintphoneConnectionEvents {
  hint: [HintShow];
  hintError: [HintError];
  state: [HintphoneConnectionState];
}

/** The slice the controller/counter need — substitutable in tests. */
interface HintphoneEventSource {
  readonly state: HintphoneConnectionState;
  submitHint(code: string): void;
  requestHintStep(hintId: string, step: number): void;
  on<K extends keyof HintphoneConnectionEvents>(event: K, listener: (...args: HintphoneConnectionEvents[K]) => void): this;
  off<K extends keyof HintphoneConnectionEvents>(event: K, listener: (...args: HintphoneConnectionEvents[K]) => void): this;
}

class HintphoneConnection implements HintphoneEventSource {
  constructor(options?: HintphoneConnectionOptions);
  readonly mode: HintphoneMode;                // resolved at construction
  get state(): HintphoneConnectionState;
  get roomKitClient(): RoomKitClient | null;   // client mode escape hatch (after connect)
  get roomKitHelper(): RoomKitHelper | null;   // helper mode escape hatch (after connect)
  connect(): void;
  setDeviceCode(code: string): void;           // client mode; stored unless persistDeviceCode: false
  clearDeviceCode(): void;                     // forget the stored code → 'needs-code'
  submitHint(code: string): void;              // reply arrives as 'hint' / 'hintError'
  requestHintStep(hintId: string, step: number): void; // step `stepCount` = explicit answer
  on(...): this; off(...): this;               // HintphoneConnectionEvents
  destroy(): void;                             // terminal
}
/** localStorage key for dialog-entered device codes, scoped per server origin. */
function hintphoneCodeKey(serverUrl: string): string;

/** Immutable per change — bindings compare by reference. */
interface HintphoneSnapshot {
  connectionState: HintphoneConnectionState;
  hint: HintShow | null;   // step/answer on screen; null = idle
  error: HintError | null; // cleared by the next successful show/submit
  pending: boolean;        // request in flight (auto-clears after 10s without a reply)
  hasPrev: boolean;
  hasNext: boolean;        // includes revealing the answer
  nextIsAnswer: boolean;   // next() reveals the explicit answer
}
const IDLE_HINTPHONE_SNAPSHOT: HintphoneSnapshot;

class HintphoneController {
  constructor(connection: HintphoneEventSource);
  get snapshot(): HintphoneSnapshot;
  subscribe(listener: () => void): () => void; // returns unsubscribe
  submitCode(code: string): void;              // trims; empty codes ignored
  prev(): void;                                // from the answer: back to the last step
  next(): void;                                // last step + hasAnswer: reveals the answer
  showAnswer(): void;                          // no-op without an explicit answer
  dismiss(): void;                             // clear hint + error
  destroy(): void;
}

interface HintCounterStats {
  hintsUsed: number;     // distinct hints shown
  stepsViewed: number;   // distinct (hint, step) pairs; the answer counts as a step
  totalShows: number;    // repeats included
  answersOpened: number; // distinct explicit answers revealed
  wrongCodes: number;    // unknown_code submissions
}
const EMPTY_HINT_COUNTER_STATS: HintCounterStats;

class HintphoneCounterCore {
  constructor(connection: HintphoneEventSource);
  get stats(): HintCounterStats;               // immutable per change
  subscribe(listener: () => void): () => void;
  reset(): void;
  destroy(): void;
}
```

The core also exposes a `@roomkit/hintphone-core/standalone` subpath: the controller/counter and their types without `HintphoneConnection` (and thus without the socket transport) — this is what the helper wrappers bundle.

### `@roomkit/hintphone-react` (deprecated)

```tsx
/** Creates connection + controller once after mount; provides context. */
function HintphoneProvider(props: {
  options?: HintphoneConnectionOptions;        // read once on mount
  children?: ReactNode;
  /** Replaces the built-in device-code dialog (client mode, no code yet). */
  renderCodeDialog?: (setCode: (code: string) => void) => ReactNode;
  dialogClassName?: string;                    // default 'rk-code-dialog'
  dialogLabels?: { title?: string; placeholder?: string; submit?: string };
}): ReactNode;

/** Nulls until the provider mounted; snapshot idles before that. */
function useHintphone(): {
  connection: HintphoneConnection | null;
  controller: HintphoneController | null;
  snapshot: HintphoneSnapshot;
};

function useHintCounter(): { stats: HintCounterStats; reset: () => void };

/** Same props as the helper-react components, minus the `hint` prop —
 *  these read the hintphone context directly. */
function HintInput(props: {
  variant?: 'keypad' | 'text'; maxLength?: number; onSubmit?: (code: string) => void;
  className?: string; labels?: { submit?: string; clear?: string; backspace?: string; placeholder?: string };
}): ReactNode;
function HintRenderer(props: {
  className?: string;
  labels?: { prev?: string; next?: string; showAnswer?: string; answer?: string; close?: string };
  errorLabels?: Partial<Record<HintErrorReason, string>>;
  closable?: boolean; empty?: ReactNode;
}): ReactNode;
```

### `@roomkit/hintphone-svelte` (deprecated)

```ts
// <HintphoneSetup options={...}> — owns connection/controller, provides context.
// Props: { options?: HintphoneConnectionOptions; children?: Snippet;
//          codeDialog?: Snippet<[(code: string) => void]>;   // custom device-code dialog
//          dialogClassName?: string; dialogLabels?: { title?; placeholder?; submit? } }

/** Call during component init below <HintphoneSetup> (throws without one). */
function getHintphone(): HintphoneContext;

class HintphoneContext {
  snapshot: HintphoneSnapshot;            // rune-backed
  connection: HintphoneConnection | null; // null until setup mounted
  controller: HintphoneController | null;
}

/** Rune-based counter; construct during component init below <HintphoneSetup>. */
class HintCounter {
  constructor(ctx?: HintphoneContext);    // default getHintphone()
  stats: HintCounterStats;                // rune-backed
  reset(): void;
}

// HintInput / HintRenderer: same props as the React components with `class`
// instead of `className` and `empty?: Snippet` instead of ReactNode.
```
