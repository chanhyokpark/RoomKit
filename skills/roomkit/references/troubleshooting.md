# Troubleshooting by Failure Mode

[RoomKit skill](../SKILL.md)

## Cannot authenticate or select a theme

Verify Server origin rather than Studio origin, credentials, and `/api/auth/login`. `rk login` accepts a URL with or without `/api`. After login, inspect returned themes and use exact UUID/name. Ambiguous partial names are rejected.

For a host-development Server, configuration failures usually mean `./init.sh` has not created `apps/server/.env`; missing-table failures mean Prisma migrations were not applied with `pnpm --filter server exec prisma migrate deploy`. Docker Server startup applies migrations automatically.

## Device is disconnected or reports `invalid_code`

Confirm whether the code is a permanent device asset code or test-session code. Test codes are valid only for their non-ended session. A pre-booted production device may need `retryOnFatalError`. Shared browser storage can cause multiple devices to reuse one stored test code; disable persistence or provide scoped storage.

## Trigger appears but event does not run

Check trigger kind/name, current phase versus event `phaseId`, once history, and re-entry state. Read trigger and event logs; a payload does not affect matching unless eval/commands consume it. `rk session trigger <id> --name <trigger> --payload '{…}'` replays the trigger server-side and reports, per listening event, `started` + `runId` or the rejection `reason` (an empty list means no event listens to that name).

## Sequence waits forever

Find the current command in live runs/logs. Then verify:

- Client play/navigate eventually calls `done`.
- Helper delegated real video calls `videoEnded` or `videoError`.
- awaited message listener promises settle.
- dialogue speaker sends progress for each line and waiting progress for `holdBefore`.
- the speaker handles the matching non-waiting resume progress.

Stop playback to resolve normally, `rk session skip <id> <runId>` to end the current entry (wait, awaited playback or message) and continue, or abort the run to cancel the remainder. `rk device logs <device> --session <id>` shows whether the device received the command and what the page logged. Virtual devices never reproduce timing stalls because they acknowledge instantly.

## Media or subtitle behavior is wrong

`url: null` is a placeholder, not a failed upload. Re-check player asset speaker/screen routing. Screen dialogue should render on progress rather than play. Loop BGM acknowledges at start. Clear subtitle on dialogue stop unless explicitly retained. Apply the lowest active BGM duck factor and restore it when all ducking media finishes.

## Screen is blank or wrong after a Player restart or reconnect

The server replays the device's current website, durable state, hint code, looping BGM and in-flight video on every (re)connect (see [reconnect replay](./system-model.md#reconnect-replay)). If a screen comes back wrong, the display was driven by a message: messages are never replayed. Move the screen's content into a state asset (`setState` / phase registration) and render from `rk.state`; keep messages for transient effects. A custom `@roomkit/client` device must apply replays idempotently (same URL → no reload, same looping BGM → keep playing, repeated identical `state` → no-op).

## State does not apply or the page shows `default`

`state.name` is the state asset's *name* (not its display name); `'default'` means no state is active — after session start, `clearState`, or a device reset. Check the operation dashboard's device panel (current state badge) and the session log: a `setState` with a missing required field is skipped with a log line, exactly like `sendMessage`. Declared names in the helper `states` option only feed the dashboard list; they never filter delivery.

## Helper receives nothing

It is likely running outside Player, was constructed before/without the current document, or the page never re-declared claims after navigation. Launch a player test session with a website URL override pointing at the dev server. Do not attempt to connect Helper to the server. Inspect Player and iframe consoles in a test session, or `rk device logs <device> --session <id>` in any session (website console lines are prefixed `site: ` with Helper 0.10.0+).

## Hosted site assets are 404

Confirm `index.html` is at ZIP root, Vite uses `base: './'`, and imports are relative. Re-upload after a clean build. External site failures are network/CORS/availability issues outside hosted-site extraction.

## Player cache or version warning is wrong

Cache sync should fall back to playback wire URLs. If both paths fail, inspect `S3_PUBLIC_ENDPOINT`, storage CORS, the presigned URL host as seen from the device, and expiry. A corrupt/missing local entry is invalidated and retried from the network.

Studio warns only for detected Player/Client/Helper versions. Update the component or intentionally override the three `PUBLIC_EXPECTED_*_VERSION` values in Studio. An absent version field means no component was detected (or an older server) and does not warn; `null` means a detected pre-reporting component and counts as outdated.

## Remote documentation read fails

`rk docs --remote` and `rk init` need outbound access to `raw.githubusercontent.com` / `codeload.github.com`. Reads time out after ten seconds and target `refs/heads/master`; unmerged documents are unavailable. The bundled copy (`rk docs list` without `--remote`) works offline. Invalid paths, traversal, query strings, fragments, and non-Markdown filenames are rejected locally.

## Production session wedged or an event did not fire

Players are in the room: inspect read-only first, change one thing at a time, and tell the user what you are about to change. Every command below works on a live production session (CLI 0.6.0+, Player 0.16.0+; `eval` also needs Helper 0.10.0+ in the site).

1. State: `rk session get <id> --json` (state, phase, timer) and `rk session runs <id> --json` (in-flight runs, their current entry, run ids).
2. Server view: `rk session logs <id> --follow` (triggers, admissions/rejections, commands, acks, errors).
3. Devices: `rk device status --session <id> --json` (online, windows, website, state, Helper version, ready).
4. Device view: `rk device logs <device> --session <id> --tail 200` — the Player's command/ack trace plus the website console and uncaught errors (`site: ` lines). Add `--level warn` to cut noise, `--follow` while reproducing.
5. Screen: `rk device screenshot <device> shot.png --session <id>` and read the image; read-only `rk device eval <device> --session <id> --script 'return document.body.innerText.slice(0, 2000)'` when the DOM matters.
6. Fix with the smallest server-side action:
   - Stuck `wait`, awaited playback or awaited message: `rk session skip <id> <runId>` (the sequence continues with the next entry); `rk session abort <id> <runId>` to cancel the rest.
   - An event that already ran once, or a device trigger that never arrived: `rk session trigger <id> <eventRef> --force` (runs that event, any phase) or `rk session trigger <id> --name <trigger> --payload '{…}' [--force]` (as if the device sent it). Read the reply: `started` + `runId`, or the `reason` it was refused.
   - Wrong phase or a phase that must replay: `rk session phase <id> <phaseRef>` / `rk session restart-phase <id>` (restart aborts that phase's runs and clears its once history).
   - One-off display or state fix: `rk session command <id> --command '{"type":"navigate",…}'` or `{"type":"setState",…}`.
   - Broken or frozen page: `rk device reload <device> --session <id> --wait-ready` (the server replays the device's state/website afterwards; messages are not replayed).
7. Verify with `rk session runs`, `rk session logs` and a fresh screenshot.

`--force` bypasses only the event's `once` history. Re-entry still applies to both forms (an event without `allowReentry` that is still running is not started again — skip or abort its run first), the phase guard still applies to `--name`, and a session that is not started or already ended refuses everything. An `<eventRef>` trigger bypasses the phase guard and the `manualTriggerable` flag on its own. A rejected `<eventRef>` fails with HTTP 4xx and the reason (`already ran (once)`, `already running (re-entry not allowed)`, …); for `--name` the reasons are in `events[].reason` (`out of phase` as well).

## Recovery evidence

Collect session ID, device code/name (not admin password), current phase/state, live run snapshot, relevant session logs, device logs (`rk device logs`, including `site: ` website lines), and installed Client/Helper version. Diagnose from the first failed contract rather than downstream UI symptoms.
