# Player Runtime Contract

[AI documentation index](../TOC_AI.md) · [Direct client contract](./client.md) · [Helper contract](./helper.md)

RoomKit Player is a Tauri launcher plus one stage webview per configured device on desktop. It is the reference `@roomkit/client` consumer: stages own default media playback and overlays, embed navigated websites, and bridge Helper envelopes. Player is not started by `pnpm infra`.

## Launcher and windows

The launcher persists the server origin, a stable launcher UUID/name, and manual device entries in the platform app-data directory. It registers on Socket.io `/player`; Studio can then send test-session start requests. On desktop the launcher has two tabs: the production tab (실제) keeps the unchanged per-device code-entry rows, and the test tab (테스트) launches player-side test sessions. Auto-opened test windows carry temporary codes in their URL and do not mutate manual launcher entries.

Desktop window labels are stable per manual device, so reopening focuses the existing stage. Test labels also include the session scope and replace stale windows whose codes have expired; the debug window uses the Tauri label `debug-<first 8 of session ID>`. Android is single-window: the first open request replaces the launcher, additional devices in the same batch are dropped, and returning to the launcher requires restarting the app. Mobile hides the test tab entirely.

## Player test sessions and the debug window

The test tab requires a server admin login (ID/password stored in plaintext in the player `config.json`; the JWT expires after sixty days and is re-minted silently on 401). It offers a theme select (admin REST `GET /themes`), a multi-select of theme devices to launch windows for, and website URL-override rows pairing a website asset with a replacement URL — a row is auto-added when a selected device has a starting webpage, and an empty URL means no substitution. Selections persist per theme in the player config (`testConfigs`). Starting a test posts `POST /sessions {themeId, mode: 'test', playerId, deviceIds, urlOverrides}`; the server pushes `test:start` to open the device windows, and the launcher opens a debug window.

The debug window (`?debug=<sessionId>&theme=<themeId>`) connects to the admin namespace with the admin JWT and uses the session REST routes. It renders the same `@roomkit/session-ui` dashboard as Studio operations. That dashboard hosts the session start button (not the launcher) plus pause/resume/end, timer adjust/pause, phase switch/restart, concurrent manual event execution grouped by phase with a live running-run list and abort, a read-only per-event sequence preview with live progress highlight, a per-device panel (online status, test-code copy, current website/media, navigate, reset, page-registered messages and test callbacks), manual media and hint controls, a command console, filtered live-log backfill, and ended-session summary.

Player-created test sessions auto-end on the server sixty seconds after all their devices disconnect (once any device has connected; reconnect cancels the countdown) and ten minutes after creation if no device ever connected.

## Stage ownership

A stage opens one `RoomKitClient` connection and constructs one playback engine. Player handles:

- BGM looping/fades and the lowest active dialogue/SFX duck factor;
- independent SFX, dialogue speaker/screen/both roles, subtitle progress, and line-cue holds;
- video placement, completion/error, replacement, and stop;
- website navigation in an iframe, structured messages, reset, placeholders, hint-code overlay, and connection status;
- Helper render claims for subtitle, hint code, and video.

Helper claims suppress only the claimed default renderer. Claims reset on navigation and are restored by the new document's hello. Real delegated video must report end/error; fileless delegated video remains timed by Player.

## Media cache

In Tauri, every welcome triggers a role-scoped `fetchAssetManifest()` sync. Speaker devices cache all theme BGM/SFX/dialogue files; screen devices cache all video files. Immutable `fileKey` presence is the freshness check. Downloads are streaming, use atomic replacement, run with concurrency two, and unreferenced keys are pruned after reconciliation.

Cache failure degrades to the presigned URL on the wire. A cache miss during playback starts a background download. Player-native renderers consume local asset/loopback URLs; an HTTPS Helper claiming video receives cached bytes through `postMessage`, which Helper converts to a same-origin `blob:` URL. Browser-only Vite development does not use the native cache.

## Test and kiosk behavior

Test stages show a collapsible bar with session/timer/verdict/cache/connection state, a payload-less trigger sender with per-device recent names, and skip controls for active dialogue/video. Skip settles playback normally, so an awaiting sequence continues. Production stages omit these controls.

Manual launcher entries can enable kiosk mode. It requests fullscreen and always-on-top, prevents close requests and common browser shortcuts, and unlocks through `Ctrl+Shift+Alt+F12` plus confirmation. It is not an OS security boundary and is disabled for auto-opened test windows.
