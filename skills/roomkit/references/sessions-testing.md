# Sessions, Testing, and Operations

[RoomKit skill](../SKILL.md)

## Session modes

A production session uses permanent device asset codes and is limited to one non-ended session per theme. Devices may lobby before it exists and attach when it is created. A test session issues session-scoped codes per device and multiple test sessions may coexist. Test-session creation accepts either explicit `deviceCodes` or a connected launcher `playerId` (optionally `deviceIds` to mint codes for a device subset only), plus `urlOverrides` that substitute website asset URLs for the whole session.

Sessions begin in `created`. Starting checks device presence in Studio, optionally resets devices, changes state to `running`, starts the timer, fires `session:start`, and enters the first phase. Session pause suspends the countdown and runtime waits; timer-only pause leaves event processing active. Ending cancels runs, releases test codes, disconnects session attachment, and is irreversible.

## Test ladder

Use the cheapest feedback loop that can prove the behavior:

1. `rk sequence validate` for schema and reference checks.
2. A one-off `rk session command` against an active test session.
3. Virtual devices (`rk device connect` / `rk device trigger`) for complete event routing without Player.
4. A player-side test session with `urlOverrides` pointing website assets at a local dev server for Helper and visual integration (`rk dev` sets this up in one command).
5. A full test session with Player and deployed sites for actual media timing, iframe behavior, audio, and cache.
6. Production rehearsal on room hardware.

## Virtual-device loop

1. `rk session create --json` — a test session; generated device codes are returned.
2. `rk device connect --session <id>` in a second terminal/background process (it stays connected and streams received commands; `--for 5m` / `--until-end` bound it).
3. `rk session start <id>`.
4. `rk device trigger <code> <event>` (waits for the event runs to finish) or `rk session trigger <id> <eventRef>`.
5. `rk session logs <id>` (or `--follow`) and the `rk device connect` stream.
6. `rk session end <id>`; the connect process exits on Ctrl-C, `--for`, or `--until-end`.

Virtual devices acknowledge every command immediately. They accurately test target routing, trigger eligibility, sequence order, dangling references, and logs. They do not test wait timing, actual media, Helper, website loading, audio mixing, or UI.

## Player test sessions

The former in-memory "website test" harness was removed. Its replacement is a real test session launched from Player itself: the launcher's test tab (desktop only, admin login required) selects a theme, a device subset, and per-website URL overrides, then creates the session with `mode: 'test'`, `playerId`, `deviceIds`, and `urlOverrides`. The server pushes a `test:start` request that opens the device windows, and the launcher opens a debug window. The same session shape is available over REST and `rk session create --player <id> --url-override <websiteRef>=<url>`; manual navigation is a one-off `rk session command <id> --command '{"type":"navigate",...}'`.

Two more ways to land in the same windows without touching the test tab:

- **App link.** Player registers the `roomkit-player://` URL scheme. `roomkit-player://test?server=<origin>&session=<id>` makes the launcher fetch the test session, open one stage window per test device code, and open the debug window (mobile: the single webview becomes the first device's stage; no debug window). A link naming a different server than the configured one is confirmed first; an admin login is required (stored credentials are used, otherwise the launcher asks). `roomkit-player://launch?server=<origin>` only starts/focuses Player. Studio shows an "open in Player" button for test sessions it created with manual codes and on the dashboard of any live test session. The launcher's test tab also has a "세션 ID로 열기" box for the same action when the scheme is not registered (a `tauri dev` build on macOS).
- **`rk dev`.** Reads `websites[].dev` and `test.devices` from `roomkit.json`, starts the dev server(s) if they are down, creates the test session with the URL overrides and `rk-…` codes, opens the app link, and streams the log until Ctrl-C ends the session. `--player <id>` uses the server push instead of the app link (for a Player on another machine; combine with `--host auto` so the overrides use the LAN address). See [cli.md](./cli.md#rk-dev).

`urlOverrides` (test mode only) replace the hosted/external base URL of the referenced website asset at resolution time for navigate and website requests; authored query parameters still append. Point an override at a Vite dev server to exercise Helper hello/claims, messages, test callbacks, subtitle/video delegation, trigger names, and timer requests against the real engine — timer, phases, hints, and answers all behave exactly as in any test session.

The debug window connects to the admin namespace with the launcher's admin JWT. Player and Studio render the same `@roomkit/session-ui` dashboard; each host supplies its own reactive socket/REST adapter. The shared dashboard offers session start/pause/resume/end, timer and phase control, manual event execution with a live run list and abort, a read-only sequence preview with live progress, a per-device panel (online status, test code, current website/media, navigate, reset, registered messages and test callbacks), manual media commands, hint push and hint-code show/hide, an inline command console, filtered live logs, and ended-session summary. The session start button lives in the debug window, not the launcher.

Player-created test sessions auto-end server-side: sixty seconds after all their devices disconnect (armed once any device has connected; cancelled on reconnect), or ten minutes after creation if no device ever connected.

## Operations behavior

The Studio operation dashboard uses the same session component and feature set as Player's debug window. Studio additionally owns session selection and component-version warnings around that shared dashboard. Operators can navigate websites, send registered Helper messages, run test callbacks, push hints, stop individual playback channels, or abort an event run from either host.

The log console accepts asset names/IDs, exposes `help` and `list`, and supports common commands directly. `json {"type":"..."}` validates and dispatches any command in the full sequence command union. It is an operator override and remains usable before start or while paused. Its local input/output appears beneath the durable server logs; only server log entries persist.

Stopping playback is normal completion: a sequence waiting on that playback continues. Aborting a run cancels its waits and remaining commands. Restarting a phase aborts runs for the phase, fires leave/enter again, and clears its once-event history. A plain phase switch does not reset once history.

Ended-session summary includes verdict, total time, remaining/overtime, hints, pauses, phase duration, and operation interventions. Logs remain the primary source for root-cause diagnosis.

## Timer semantics

Themes may have no time limit. A countdown starts only when the session starts. Session pause freezes it. At zero, `timer:expired` events fire. Adjusting a running timer to zero expires immediately; adjusting a paused timer to zero clamps near expiry and expiration occurs on resume. Timer state broadcasts are snapshots; clients tick locally or request a resync.
