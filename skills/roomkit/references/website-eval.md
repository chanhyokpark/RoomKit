# Website JS evaluation and screenshots

[RoomKit skill](../SKILL.md) · [Sessions and testing](./sessions-testing.md)

Use `rk device eval` to inspect or interact with the actual website shown inside a Player test window. JS travels through the authenticated server and Player to the site's Helper, which executes it in that iframe's realm. No Playwright, Puppeteer, Selenium, browser driver, or OS automation is needed for this workflow. Its companions `rk device status | focus | screenshot | reload` diagnose the window, bring it to the front, capture it without a website, and force-reload the page (see [Window, screenshot, reload and status](#window-screenshot-reload-and-status)).

## Prerequisites

- Updated server supporting `POST /api/sessions/:id/devices/:deviceId/eval`, CLI 0.4.0+, Player 0.14.0+ (client 0.6.0+), and Helper 0.9.0+ in the website. Rebuild/reload sites bundling an older Helper; React/Svelte wrappers inherit support through their Helper dependency. `rk device focus|screenshot|reload|status` and `--focus` need CLI 0.5.0+, a server with `/devices`, `/window` and `/reload` routes, and Player 0.15.0+ (client 0.7.0+); an older Player answers window requests with `unsupported`.
- A live **test** session and exactly one connected Player window for the device, with the website's Helper handshake complete. Created/paused sessions also work. Production and ended sessions are rejected.
- Use `rk dev` or an existing Player test session. With `rk dev --json`, start dev servers separately; the command detaches. Use `--player <launcherId>` or open the returned app link/session in Player. Start/navigate the session if its website is not loaded yet.
- `<device>` accepts an asset key, permanent code, name or UUID, resolved in the **specified session's theme**. Generated test connection codes are not asset references. Virtual devices cannot render/evaluate websites; do not connect one under the same code as the Player.

## Execution

```sh
rk device eval main-screen --session <sessionId> --script 'return { title: document.title, text: document.body.innerText.slice(0, 2000) };' --json
rk device eval main-screen --session <sessionId> --file test.js --timeout 10000 --screenshot result.png --json
```

Pass exactly one of `--script` (inline source) or `--file` (UTF-8 file, or `-` for stdin). Prefer files for multiline code to avoid shell interpolation. `--focus` first brings the Player window to the front (show, unminimize, focus, wait until visible) so the script runs and paints in a visible window; `--overwrite` lets `--screenshot` replace an existing file. The source is an **async function body**: use `return` for results and `await` for asynchronous work. It can access `document`, `window` and page globals; module-local component variables are not automatically exposed.

Bindings:

- `roomkit`: the current `RoomKitHelper`, e.g. `await roomkit.triggerAndWait('answer:submit', { answer: '1234' })`. A direct trigger does not verify a UI handler; interact with the DOM when testing that handler.
- `waitFor(predicate, { timeoutMs?, intervalMs? })`: polls a sync/async predicate until truthy, returning that value. Default interval 25ms; default deadline is the script timeout. Throw/reject to fail.
- `signal`: an `AbortSignal` for cooperative cancellation, including `fetch(url, { signal })`.

Example `test.js` (adapt selectors and events to the site's framework):

```js
const input = document.querySelector('[data-testid="answer"]');
if (!input) throw new Error('Answer input is missing');
const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
setValue.call(input, '1234');
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));

const button = document.querySelector('[data-testid="submit"]');
if (!button || button.disabled) throw new Error('Submit button is unavailable');
button.click();
const success = await waitFor(() => document.querySelector('[data-testid="success"]'));
return { success: true, message: success.textContent };
```

Return JSON values only. A void/top-level `undefined` return becomes `null`. DOM nodes, functions, BigInt, circular values, undefined object properties and non-finite numbers fail serialization. Return selected text/attributes rather than nodes or the whole DOM. Source limit: 64,000 characters; serialized return limit: 32,000 characters.

## Results and images

Success: `{requestId, ok:true, value, screenshot?:{path,mimeType,width,height,capturedAt}}`. **Open `screenshot.path` with the agent's image-reading tool** to visually verify the result; a filename alone is not visual verification.

`--screenshot result.png` or `.jpg`/`.jpeg` requests a fresh native WebView capture after successful JS execution and paint, including Player stage overlays. This is the current viewport, not a full-page screenshot, capped at 960px width and 800,000 data-URL characters. PNGs over the cap fail; use JPEG for complex screens. The window must be visible: a hidden (minimized or fully covered) window fails the capture with "Show the Player window before capturing" — pass `--focus` (or run `rk device focus` first) instead of relying on the app link. Browser-only Player dev has no native capture. Existing output files are refused before execution unless `--overwrite`; otherwise use a new path per step.

The periodic dashboard image is never substituted. Failed scripts do not produce an image. Failures exit nonzero; `--json` errors go to stderr as `{error:{code,message,details:{requestId,result,screenshotError?}}}`. Script errors include a bounded stack when available. Capture/save failure preserves the successful JS return in `details.result`. HTTP success alone does not imply script success.

## Limits and recovery

- `--timeout`: default 10,000ms, range 100–60,000ms. Capture/transport have up to seven extra seconds. Await the desired state in JS: paint alone does not wait for arbitrary API calls or animations.
- A timeout bounds the reply, not synchronous infinite loops, rollback, or non-cooperative async work. The Helper refuses further evaluations after its script timeout until the website reloads. Disconnects/lost replies may also mean the script already ran. **Do not automatically retry mutations after these failures.** Inspect the state (`rk device status`, `rk device screenshot`) and, if the page is wedged, `rk device reload <device> --session <id> --wait-ready` before the next evaluation.
- Navigation/reload invalidates pending results, including capture in progress. Split navigation and inspection into calls separated by the new Helper handshake: `rk device reload --wait-ready` returns only after that handshake, and `rk device status --wait-ready` waits for it after a navigate.
- Error codes to branch on: `test_only` (not a live test session), `device_unavailable`/409 "offline" (open the session in Player), 409 "multiple windows" (close duplicate stage windows of that device), `helper_unavailable`/`unsupported` (no Helper hello yet, old Helper, or old Player — check `rk device status`), `busy` (one request at a time per device), `timeout`/`page_gone` (do not retry blindly), `capture_failed` (window hidden or capture too large — use `--focus`/JPEG), `focus_failed` (the OS kept the window hidden; use the app link or click the window), `not_ready` (`--wait-ready` deadline).
- JS uses the site's CSP-governed `AsyncFunction`. If CSP blocks dynamic evaluation, the call fails; do not weaken production CSP automatically. Helper-free sites and cross-origin nested frames without their own integration are outside this surface.
- `.click()` and dispatched events are synthetic. This does not verify trusted user gestures, native keyboard/touch behavior, permission dialogs or file pickers.

## Window, screenshot, reload and status

These do not need a website or a Helper: they talk to the Player stage window itself (`device:window`) or to the runtime's view of the device.

```sh
rk device status --session <sessionId> [--device <ref>] [--wait-ready --timeout 30000] --json
rk device focus <device> --session <sessionId> [--timeout 10000] --json
rk device screenshot <device> <path.png|path.jpg> --session <sessionId> [--focus] [--overwrite] --json
rk device reload <device> --session <sessionId> [--wait-ready] [--focus] [--timeout 15000] --json
```

- `status` lists every device of the session's theme with `online`, `windows` (socket count; eval/window need exactly one), `clientVersion`, `helperVersion` (absent = no Helper hello since the last navigate), `helperTestCallbacks`, `website` (what the server last navigated the device to), `state`, `screenshotAt` and `ready` (one window online and, if a website is shown, its Helper said hello). Works for production sessions too. `--wait-ready` polls until all devices (or `--device`) are ready, exits with `not_ready` otherwise — use it right after `rk dev` or a navigate instead of sleeping.
- `focus` shows the window, restores it from the dock/taskbar, gives it focus (activating the app on macOS) and waits until the document is visible, then reports `{visible, focused, platform}`. `visible:false` after a successful call means the OS still occludes it. Mobile Players have no window management; the call reports the current visibility.
- `screenshot` captures the stage window the same way `eval --screenshot` does, but also on the idle screen, during video playback, before the Helper loads, or while the page is wedged. Same size caps and formats; `--focus` first brings the window forward.
- `reload` re-sends the device's current website as a forced navigate (Player re-creates the iframe for the same URL, which also clears a Helper that refused evaluations after a timeout) and waits for the load ack. `--wait-ready` additionally waits for the new page's Helper hello and returns its version and test callbacks; without it, `helperReady` is absent and a following `eval` may race the handshake. Fails with `reload_failed` when the page did not load before `--timeout`, `helper_not_ready` when it loaded but no Helper said hello, 400 when the device shows no website (navigate first), 409 when offline or duplicated.

Recommended loop for an agent test step: `rk device status --wait-ready` once → `rk device eval … --focus --screenshot step1.png` per interaction → read the image → on `timeout`/`page_gone`/`helper_unavailable`, `rk device reload … --wait-ready` and re-inspect (never re-send the mutation blindly).

This is a test RPC, not the server-side sequence `eval` command. Game logic remains server-owned.
