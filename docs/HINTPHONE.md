# @roomkit/hintphone-react / @roomkit/hintphone-svelte — Hintphone Component Library

Headless UI components for building a **hintphone** — the device teams use to enter hint codes and read hint steps. The same component set ships in two flavors:

| Package | Framework | Components |
|---|---|---|
| `@roomkit/hintphone-react` | React ≥ 18 | `HintphoneProvider`, `HintInput`, `HintRenderer`, `useHintphone()`, `useHintCounter()` |
| `@roomkit/hintphone-svelte` | Svelte 5 | `HintphoneSetup`, `HintInput`, `HintRenderer`, `getHintphone()`, `HintCounter` |

Both wrap the shared `@roomkit/hintphone-core` (bundled in — installs are self-contained apart from `socket.io-client`/`zod`). **Headless**: every component renders semantic, unstyled DOM with stable class hooks (`.rk-hint*`, `.rk-code-dialog*`) — bring your own CSS.

---

## 1. Setup — automatic transport selection

The setup component owns the RoomKit connection and picks the transport:

- **helper mode** — the page runs inside a Player device window (an iframe): it bridges through `@roomkit/helper` over postMessage. No code, no server URL needed.
- **client mode** — the page runs standalone: it connects through `@roomkit/client` with a device code. If no `deviceCode` is configured, a minimal `<dialog>` asks for one; the entered code is stored in localStorage (per server origin) and reused on the next load. A rejected code (invalid / session ended) clears the stored code and re-opens the dialog.

`mode: 'auto'` (the default) selects helper mode exactly when the page is embedded in an iframe; force it with `mode: 'client' | 'helper'`.

React:

```tsx
import { HintphoneProvider, HintInput, HintRenderer } from '@roomkit/hintphone-react';

<HintphoneProvider options={{ serverUrl: 'http://localhost:3000' }}>
  <HintInput variant="keypad" />
  <HintRenderer />
</HintphoneProvider>
```

Svelte:

```svelte
<script lang="ts">
  import { HintphoneSetup, HintInput, HintRenderer } from '@roomkit/hintphone-svelte';
</script>

<HintphoneSetup options={{ serverUrl: 'http://localhost:3000' }}>
  <HintInput variant="keypad" />
  <HintRenderer />
</HintphoneSetup>
```

Options (`HintphoneConnectionOptions`): `mode`, `serverUrl`, `deviceCode`, `deviceName`, `persistDeviceCode` (default true), `lockdown` (helper kiosk lockdown), `debug`. Replace the built-in dialog with `renderCodeDialog` (React render prop) / `codeDialog` (Svelte snippet) — both receive a `setCode(code)` callback.

## 2. HintInput — code entry

`variant: 'keypad'` (default) renders an on-screen keypad (digits, clear, backspace, submit) — `variant: 'text'` a plain input + submit. Submitting calls the controller's `submitCode`, which emits `hint:submit` on the connection; override with `onSubmit`. Class hooks: `.rk-hint-input`, `-display`, `-keys`, `-key` (`data-key="7"`), `-key-clear`, `-key-back`, `-submit`, `-field`; the root carries `data-variant`.

## 3. HintRenderer — steps and the answer

Renders the current hint: the step HTML (`textHtml`, trusted studio-authored input), the optional image, and prev/next navigation. On the last step of a hint with an explicit answer the next button becomes **정답 보기** (`data-answer` set); the revealed answer shows **정답** as its step indicator. Errors (`unknown_code` etc.) render as `.rk-hint-error` with Korean default texts — override via `errorLabels`. All labels are overridable via `labels`; `closable` (default true) adds a dismiss button; `empty` renders while nothing is shown.

Class hooks: `.rk-hint`, `-header`, `-code`, `-step`, `-close`, `-body`, `-image`, `-nav`, `-prev`, `-next`, `-error`.

## 4. Counter — usage stats

Tracks `hintsUsed` (unique hints), `stepsViewed` (unique hint+step pairs), `totalShows`, `answersOpened` (unique hints whose answer was revealed), `wrongCodes` (rejected code entries). Admin-pushed hints count too — the stats follow everything shown on this device.

React (hook):

```tsx
const { stats, reset } = useHintCounter();
```

Svelte (rune class — instantiate during component init):

```svelte
<script lang="ts">
  import { HintCounter } from '@roomkit/hintphone-svelte';
  const counter = new HintCounter();
</script>
힌트 {counter.stats.hintsUsed} · 정답 {counter.stats.answersOpened}
```

## 5. Escape hatches

`useHintphone()` / `getHintphone()` expose the reactive snapshot plus the underlying `HintphoneController` (submitCode / prev / next / showAnswer / dismiss) and `HintphoneConnection` (`roomKitClient` / `roomKitHelper`) for anything the components don't cover. `@roomkit/hintphone-core` is also usable standalone (no framework) — same controller/counter over a `HintphoneEventSource`.

## 6. The explicit answer (server contract)

Hint assets may carry an explicit **answer** step (authored in studio, revealed after the last step). On the wire the answer is addressed as step index `stepCount`: `hint` events carry `hasAnswer`/`isAnswer`, and `requestHintStep(hintId, stepCount)` reveals the answer. Servers/players predating the feature simply never set `hasAnswer` — the components degrade to plain step navigation.
