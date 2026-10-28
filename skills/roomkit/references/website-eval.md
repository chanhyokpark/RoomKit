# Website JS evaluation and screenshots

[RoomKit skill](../SKILL.md) · [Sessions and testing](./sessions-testing.md)

Use `rk device eval` to inspect or interact with the actual website shown inside a Player test window. JS travels through the authenticated server and Player to the site's Helper, which executes it in that iframe's realm. No Playwright, Puppeteer, Selenium, browser driver, or OS automation is needed for this workflow.

## Prerequisites

- Updated server supporting `POST /api/sessions/:id/devices/:deviceId/eval`, CLI 0.4.0+, Player 0.14.0+ (client 0.6.0+), and Helper 0.9.0+ in the website. Rebuild/reload sites bundling an older Helper; React/Svelte wrappers inherit support through their Helper dependency.
- A live **test** session and exactly one connected Player window for the device, with the website's Helper handshake complete. Created/paused sessions also work. Production and ended sessions are rejected.
- Use `rk dev` or an existing Player test session. With `rk dev --json`, start dev servers separately; the command detaches. Use `--player <launcherId>` or open the returned app link/session in Player. Start/navigate the session if its website is not loaded yet.
- `<device>` accepts an asset key, permanent code, name or UUID, resolved in the **specified session's theme**. Generated test connection codes are not asset references. Virtual devices cannot render/evaluate websites; do not connect one under the same code as the Player.

## Execution

```sh
rk device eval main-screen --session <sessionId> --script 'return { title: document.title, text: document.body.innerText.slice(0, 2000) };' --json
rk device eval main-screen --session <sessionId> --file test.js --timeout 10000 --screenshot result.png --json
```

Pass exactly one of `--script` (inline source) or `--file` (UTF-8 file, or `-` for stdin). Prefer files for multiline code to avoid shell interpolation. The source is an **async function body**: use `return` for results and `await` for asynchronous work. It can access `document`, `window` and page globals; module-local component variables are not automatically exposed.

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

`--screenshot result.png` or `.jpg`/`.jpeg` requests a fresh native WebView capture after successful JS execution and paint, including Player stage overlays. This is the current viewport, not a full-page screenshot, capped at 960px width and 800,000 data-URL characters. PNGs over the cap fail; use JPEG for complex screens. Keep the Player window visible. Browser-only Player dev has no native capture. Existing output files are refused before execution; use a new path per step.

The periodic dashboard image is never substituted. Failed scripts do not produce an image. Failures exit nonzero; `--json` errors go to stderr as `{error:{code,message,details:{requestId,result,screenshotError?}}}`. Script errors include a bounded stack when available. Capture/save failure preserves the successful JS return in `details.result`. HTTP success alone does not imply script success.

## Limits and recovery

- `--timeout`: default 10,000ms, range 100–60,000ms. Capture/transport have up to seven extra seconds. Await the desired state in JS: paint alone does not wait for arbitrary API calls or animations.
- A timeout bounds the reply, not synchronous infinite loops, rollback, or non-cooperative async work. The Helper refuses further evaluations after its script timeout until the website reloads. Disconnects/lost replies may also mean the script already ran. **Do not automatically retry mutations after these failures.** Inspect/reload the test website first.
- Navigation/reload invalidates pending results, including capture in progress. Split navigation and inspection into calls separated by the new Helper handshake.
- JS uses the site's CSP-governed `AsyncFunction`. If CSP blocks dynamic evaluation, the call fails; do not weaken production CSP automatically. Helper-free sites and cross-origin nested frames without their own integration are outside this surface.
- `.click()` and dispatched events are synthetic. This does not verify trusted user gestures, native keyboard/touch behavior, permission dialogs or file pickers.

This is a test RPC, not the server-side sequence `eval` command. Game logic remains server-owned.
