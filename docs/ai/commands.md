# Sequence Command Runtime

[AI documentation index](../TOC_AI.md) · [Theme authoring](./authoring.md)

Always use MCP `describe_commands` or `packages/shared/src/commands.ts` for the exact current JSON Schema. This document describes semantics that cannot be inferred from field types alone.

## Playback commands

Dialogue, SFX, video, and BGM play commands reference a media asset and player asset. Their stop commands target one player or all players. `waitUntilEnd` blocks the sequence on device acknowledgment.

- **Dialogue** routes voice to the speaker device and subtitle progress to the screen device. Line cues are mini-sequences anchored after a dialogue line ID. The speaker holds before the following line, the cue runs, and playback resumes. Missing/last-line anchors are skipped with warnings. Stopping dialogue clears subtitle state and resolves playback normally.
- **SFX** mixes with dialogue and BGM. Player-level SFX ducking reduces BGM while any SFX is active.
- **Video** routes to the screen device using the authored full-screen/percentage frame. A Helper page that claims video replaces Player's renderer and must report end/error.
- **BGM** applies asset fade-in/fade-out. Looping BGM acknowledges on start and cannot meaningfully be waited to natural completion.

Placeholder playback has `url: null` and a duration. It follows the same acknowledgment rules. Stop commands are normal completion, not run abortion.

## Device commands

- `resetDevice` and `resetAllDevices` return targets to initial state.
- `navigate` resolves the website URL, appends authored query pairs, and waits for the target's load acknowledgment.
- `sendMessage` validates values against the message asset schema. With awaited handling, the client defers acknowledgment until all message listeners settle.
- `sendWebsiteRequest` performs an HTTP request from the RoomKit server to a URL built from a website asset and path. GET/HEAD omit a body. Network and non-2xx responses are logged; the sequence continues.
- `showHintCode` and `hideHintCode` update the default Player overlay or delegated Helper slot.

## Flow and operation commands

- `wait` is a server timer paused together with the session.
- `switchPhase` completes leave hooks before changing phase and then runs enter hooks.
- `callEvent` reuses another event sequence and passes the current payload. Optional waiting blocks until the callee completes. Recursion depth is limited to eight.
- `eval` runs synchronous JavaScript in a server `node:vm` context with a one-second timeout. Returning `false` stops the current sequence.
- `endTheme` records success/fail, resets devices, and ends the session according to current runtime behavior.
- `adjustTimer` adds signed milliseconds or pauses/resumes the countdown.
- `notify` emits an operator toast and log entry.

## Interpolation

Supported string fields use `{{vars.path}}` and `{{payload.path}}`. A string consisting of exactly one template preserves the JSON type; unresolved exact values become null. Templates embedded in a larger string stringify the value. Query fields, message values, and website request fields support interpolation as documented by their schema.

Do not use interpolation for asset IDs. Resolve assets before writing the sequence and store their UUIDs.

## Eval context

```js
ctx.vars;                 // mutable, session-persisted object
ctx.payload;              // current trigger JSON or null
ctx.phase;                // current phase name or null
ctx.trigger(name);        // trigger matching eligible events
ctx.log(message);         // append a session log
ctx.switchPhase(name);    // queue an action
ctx.notify(message);      // queue an action
ctx.adjustTimer(value);   // signed ms, 'pause', or 'resume'
ctx.endTheme(verdict);    // 'success' or 'fail'
```

Queued actions validate arguments immediately but execute after the script returns, in call order. Exceptions fail the eval command and prevent remaining script statements. `return false` is the supported guard idiom.

## Failure behavior

- Invalid sequence JSON is rejected at authoring validation.
- Valid commands referencing deleted assets are skipped and logged.
- A failed device acknowledgment logs failure and continues.
- Offline targets do not wait.
- Aborting a run or restarting its phase cancels outstanding waits and prevents remaining commands.
- Concurrent runs share `ctx.vars`; design updates defensively when two events can write the same key.
