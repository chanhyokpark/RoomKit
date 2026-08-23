# Hintphone Component Integration

[AI documentation index](../TOC_AI.md) · [React example](../../templates/hintphone/README.md)

RoomKit provides transport/controller core plus React and Svelte bindings. The UI packages are headless: they emit semantic DOM and class hooks but do not ship theme styling.

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

A successful hint payload contains `hintId`, code, zero-based step, step count, answer flags, trusted HTML, and optional image URL. The controller requests exact step numbers; it does not mutate server-side progress. When a hint has an explicit answer, requesting `stepCount` returns `isAnswer: true`.

Error reasons are `unknown_code`, `unknown_hint`, `invalid_step`, `not_hint_device`, and `session_not_running`. Pending UI must clear on both hint and error events.

The attached device must be marked as a hint device. Operator push can display a step without code entry but is still logged as hint usage.

Website-test runs intentionally do not execute the hint service: submissions are logged and return `session_not_running`. Test successful steps, answer navigation, and operator push in a running test session. The push endpoint/MCP action exists, but the current Studio operation dashboard keeps its hint-push card hidden.

## SSR and lifecycle

Before mount and during SSR, UI bindings expose an idle snapshot. Destroy controller/connection on unmount. React Strict Mode may run an effect setup/cleanup probe in development; integrations must not create transport objects during render.
