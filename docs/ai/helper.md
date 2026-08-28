# `@roomkit/helper` Integration Contract

[AI documentation index](../TOC_AI.md) · [React example](../../templates/web/README.md)

Use Helper only for a website navigated inside RoomKit Player's iframe. It does not connect to the RoomKit server. All traffic is `postMessage` through Player's existing device socket. A standalone browser/device must use [`@roomkit/client`](./client.md).

## Construction and handshake

```ts
const helper = new RoomKitHelper({
  lockdown: true,
  renders: { subtitle: true, hintCode: false, video: true },
  messages: {
    "set-screen": async (payload, envelope) => updateScreen(payload),
  },
  testCallbacks: {
    "flash-panel": () => flashPanel(),
  },
});
```

Construction installs a message listener, optional kiosk lockdown, and emits `hello` with render claims, helper version, and the registered `messages`/`testCallbacks` names. Hello repeats every 800 ms up to 25 times until a Player message proves the bridge is alive. Player buffers state until hello, so a late page receives the current subtitle/hint/video-related state.

Navigation destroys claims. Every new document must construct Helper again. `destroy()` removes listeners/styles, rejects pending trigger waits, resolves pending timer requests with null, and permanently retires the instance.

## General API

- `trigger(event, payload?)` reports a JSON trigger without a response.
- `triggerAndWait(event, payload?, { timeoutMs? })` resolves after all event runs started by that trigger finish. Default timeout is ten minutes; timeout does not cancel server runs.
- `submitHint(code)` and `requestHintStep(hintId, step)` implement hint navigation.
- `getRemainingTime({ resync?, timeoutMs? })` requests Player's timer snapshot. It rejects when no Player answers.
- `sessionMode` is `production` until Player reports `test` or `production`.
- `on`/`off` subscribe to `message`, hint events, and claimed render slots.

Prefer the `messages` constructor option: named handlers are dispatched by `messageName` and their registered names surface in the debug window's per-device panel. `on('message')` still works but is deprecated. Awaited send-message commands carry a command ID. Helper waits for every named handler's and message listener's returned promise and posts `message:done`; one rejection marks handling failed but does not stop the server sequence.

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
