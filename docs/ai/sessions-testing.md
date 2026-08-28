# Sessions, Testing, and Operations

[AI documentation index](../TOC_AI.md)

## Session modes

A production session uses permanent device asset codes and is limited to one non-ended session per theme. Devices may lobby before it exists and attach when it is created. A test session issues session-scoped codes per device and multiple test sessions may coexist. Test-session creation accepts either explicit `deviceCodes` or a connected launcher `playerId` (optionally `deviceIds` to mint codes for a device subset only), plus `urlOverrides` that substitute website asset URLs for the whole session.

Sessions begin in `created`. Starting checks device presence in Studio, optionally resets devices, changes state to `running`, starts the timer, fires `session:start`, and enters the first phase. Session pause suspends the countdown and runtime waits; timer-only pause leaves event processing active. Ending cancels runs, releases test codes, disconnects session attachment, and is irreversible.

## Test ladder

Use the cheapest feedback loop that can prove the behavior:

1. `validate_sequence` for schema and reference checks.
2. A one-off `run_session_command` against an active test session.
3. Virtual MCP devices for complete event routing without Player.
4. A player-side test session with `urlOverrides` pointing website assets at a local dev server for Helper and visual integration.
5. A full test session with Player and deployed sites for actual media timing, iframe behavior, audio, and cache.
6. Production rehearsal on room hardware.

## MCP virtual-device loop

1. Create a test session; generated codes are returned.
2. Connect virtual devices for that session.
3. Start the session explicitly.
4. Emit device triggers or manually trigger events.
5. Read logs and virtual device state.
6. End the session and disconnect devices.

Virtual devices acknowledge every command immediately. They accurately test target routing, trigger eligibility, sequence order, dangling references, and logs. They do not test wait timing, actual media, Helper, website loading, audio mixing, or UI.

## Player test sessions

The former in-memory "website test" harness was removed. Its replacement is a real test session launched from Player itself: the launcher's test tab (desktop only, admin login required) selects a theme, a device subset, and per-website URL overrides, then creates the session with `mode: 'test'`, `playerId`, `deviceIds`, and `urlOverrides`. The server pushes a `test:start` request that opens the device windows, and the launcher opens a debug window. The same session shape is available over REST/MCP `create_session`; manual navigation is a one-off `run_session_command` navigate.

`urlOverrides` (test mode only) replace the hosted/external base URL of the referenced website asset at resolution time for navigate and website requests; authored query parameters still append. Point an override at a Vite dev server to exercise Helper hello/claims, messages, test callbacks, subtitle/video delegation, trigger names, and timer requests against the real engine — timer, phases, hints, and answers all behave exactly as in any test session.

The debug window connects to the admin namespace with the launcher's admin JWT. It offers session start/pause/resume/end, timer and phase control, manual event execution with a live run list and abort, a read-only sequence preview with live progress, a per-device panel (online status, test code, current website, navigate, reset, registered messages and test callbacks), manual media commands, hint push and hint-code show/hide, and a filtered live log feed. The session start button lives in the debug window, not the launcher.

Player-created test sessions auto-end server-side: sixty seconds after all their devices disconnect (armed once any device has connected; cancelled on reconnect), or ten minutes after creation if no device ever connected.

## Operations behavior

The operation dashboard provides current phase, session-level and timer-only pause controls, manual events, device state/playback, live runs, logs, test codes, an inline one-off command console, component-version warnings, and ended-session summary. Operators can stop individual playback channels or abort an event run. The hint-push REST/MCP action is implemented and exposed in the Player debug window, but its Studio dashboard card is currently hidden.

The log console accepts asset names/IDs, exposes `help` and `list`, and dispatches the same command union as event sequences outside a run. It is an operator override and remains usable before start or while paused. Its local input/output is interleaved with durable server logs; only server log entries persist.

Stopping playback is normal completion: a sequence waiting on that playback continues. Aborting a run cancels its waits and remaining commands. Restarting a phase aborts runs for the phase, fires leave/enter again, and clears its once-event history. A plain phase switch does not reset once history.

Ended-session summary includes verdict, total time, remaining/overtime, hints, pauses, phase duration, and operation interventions. Logs remain the primary source for root-cause diagnosis.

## Timer semantics

Themes may have no time limit. A countdown starts only when the session starts. Session pause freezes it. At zero, `timer:expired` events fire. Adjusting a running timer to zero expires immediately; adjusting a paused timer to zero clamps near expiry and expiration occurs on resume. Timer state broadcasts are snapshots; clients tick locally or request a resync.
