# Troubleshooting by Failure Mode

[RoomKit skill](../SKILL.md)

## Cannot authenticate or select a theme

Verify Server origin rather than Studio origin, credentials, and `/api/auth/login`. `rk login` accepts a URL with or without `/api`. After login, inspect returned themes and use exact UUID/name. Ambiguous partial names are rejected.

For a host-development Server, configuration failures usually mean `./init.sh` has not created `apps/server/.env`; missing-table failures mean Prisma migrations were not applied with `pnpm --filter server exec prisma migrate deploy`. Docker Server startup applies migrations automatically.

## Device is disconnected or reports `invalid_code`

Confirm whether the code is a permanent device asset code or test-session code. Test codes are valid only for their non-ended session. A pre-booted production device may need `retryOnFatalError`. Shared browser storage can cause multiple devices to reuse one stored test code; disable persistence or provide scoped storage.

## Trigger appears but event does not run

Check trigger kind/name, current phase versus event `phaseId`, once history, and re-entry state. Read trigger and event logs; a payload does not affect matching unless eval/commands consume it.

## Sequence waits forever

Find the current command in live runs/logs. Then verify:

- Client play/navigate eventually calls `done`.
- Helper delegated real video calls `videoEnded` or `videoError`.
- awaited message listener promises settle.
- dialogue speaker sends progress for each line and waiting progress for `holdBefore`.
- the speaker handles the matching non-waiting resume progress.

Stop playback to resolve normally or abort the run to cancel the remainder. Virtual devices never reproduce timing stalls because they acknowledge instantly.

## Media or subtitle behavior is wrong

`url: null` is a placeholder, not a failed upload. Re-check player asset speaker/screen routing. Screen dialogue should render on progress rather than play. Loop BGM acknowledges at start. Clear subtitle on dialogue stop unless explicitly retained. Apply the lowest active BGM duck factor and restore it when all ducking media finishes.

## Screen is blank or wrong after a Player restart or reconnect

The server replays the device's current website, durable state, hint code, looping BGM and in-flight video on every (re)connect (see [reconnect replay](./system-model.md#reconnect-replay)). If a screen comes back wrong, the display was driven by a message: messages are never replayed. Move the screen's content into a state asset (`setState` / phase registration) and render from `rk.state`; keep messages for transient effects. A custom `@roomkit/client` device must apply replays idempotently (same URL → no reload, same looping BGM → keep playing, repeated identical `state` → no-op).

## State does not apply or the page shows `default`

`state.name` is the state asset's *name* (not its display name); `'default'` means no state is active — after session start, `clearState`, or a device reset. Check the operation dashboard's device panel (current state badge) and the session log: a `setState` with a missing required field is skipped with a log line, exactly like `sendMessage`. Declared names in the helper `states` option only feed the dashboard list; they never filter delivery.

## Helper receives nothing

It is likely running outside Player, was constructed before/without the current document, or the page never re-declared claims after navigation. Launch a player test session with a website URL override pointing at the dev server. Do not attempt to connect Helper to the server. Inspect Player and iframe consoles in a test session.

## Hosted site assets are 404

Confirm `index.html` is at ZIP root, Vite uses `base: './'`, and imports are relative. Re-upload after a clean build. External site failures are network/CORS/availability issues outside hosted-site extraction.

## Player cache or version warning is wrong

Cache sync should fall back to playback wire URLs. If both paths fail, inspect `S3_PUBLIC_ENDPOINT`, storage CORS, the presigned URL host as seen from the device, and expiry. A corrupt/missing local entry is invalidated and retried from the network.

Studio warns only for detected Player/Client/Helper versions. Update the component or intentionally override the three `PUBLIC_EXPECTED_*_VERSION` values in Studio. An absent version field means no component was detected (or an older server) and does not warn; `null` means a detected pre-reporting component and counts as outdated.

## Remote documentation read fails

`rk docs --remote` and `rk init` need outbound access to `raw.githubusercontent.com` / `codeload.github.com`. Reads time out after ten seconds and target `refs/heads/master`; unmerged documents are unavailable. The bundled copy (`rk docs list` without `--remote`) works offline. Invalid paths, traversal, query strings, fragments, and non-Markdown filenames are rejected locally.

## Recovery evidence

Collect session ID, device code/name (not admin password), current phase/state, live run snapshot, relevant session logs, Player/browser console, and installed Client/Helper version. Diagnose from the first failed contract rather than downstream UI symptoms.
