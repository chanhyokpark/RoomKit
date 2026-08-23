# Sessions, Testing, and Operations

[AI documentation index](../TOC_AI.md)

## Session modes

A production session uses permanent device asset codes and is limited to one non-ended session per theme. Devices may lobby before it exists and attach when it is created. A test session issues session-scoped codes per device and multiple test sessions may coexist.

Sessions begin in `created`. Starting checks device presence in Studio, optionally resets devices, changes state to `running`, starts the timer, fires `session:start`, and enters the first phase. Session pause suspends the countdown and runtime waits; timer-only pause leaves event processing active. Ending cancels runs, releases test codes, disconnects session attachment, and is irreversible.

## Test ladder

Use the cheapest feedback loop that can prove the behavior:

1. `validate_sequence` for schema and reference checks.
2. A one-off `run_session_command` against an active test session.
3. Virtual MCP devices for complete event routing without Player.
4. Studio website test for Helper and visual integration without a saved session.
5. A full test session with Player for actual media timing, iframe behavior, audio, and cache.
6. Production rehearsal on room hardware.

## MCP virtual-device loop

1. Create a test session; generated codes are returned.
2. Connect virtual devices for that session.
3. Start the session explicitly.
4. Emit device triggers or manually trigger events.
5. Read logs and virtual device state.
6. End the session and disconnect devices.

Virtual devices acknowledge every command immediately. They accurately test target routing, trigger eligibility, sequence order, dangling references, and logs. They do not test wait timing, actual media, Helper, website loading, audio mixing, or UI.

## Website test

Website tests are in-memory and require a connected Player launcher plus player ID. Select a device and URL, then use manual commands or authored event sequences. The harness supplies a simulated timer and captures triggers rather than executing them automatically. It can expose a test device code so a direct Client page joins the same harness.

Use website test to verify Helper hello/claims, messages, hints, subtitle/video delegation, trigger names, timer requests, and acknowledgment. Runs expire after twelve hours and disappear on server restart.

## Operations behavior

The operation dashboard provides current phase, timer, manual events, hint push, device state/playback, live runs, logs, test codes, and ended-session summary. Operators can stop individual playback channels or abort an event run.

Stopping playback is normal completion: a sequence waiting on that playback continues. Aborting a run cancels its waits and remaining commands. Restarting a phase aborts runs for the phase, fires leave/enter again, and clears its once-event history. A plain phase switch does not reset once history.

Ended-session summary includes verdict, total time, remaining/overtime, hints, pauses, phase duration, and operation interventions. Logs remain the primary source for root-cause diagnosis.

## Timer semantics

Themes may have no time limit. A countdown starts only when the session starts. Session pause freezes it. At zero, `timer:expired` events fire. Adjusting a running timer to zero expires immediately; adjusting a paused timer to zero clamps near expiry and expiration occurs on resume. Timer state broadcasts are snapshots; clients tick locally or request a resync.
