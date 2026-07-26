/**
 * AI-facing orientation document, returned by the get_started tool and the
 * roomkit://guide resource. Written for an agent that has never seen RoomKit.
 */
export const GUIDE = `# RoomKit MCP guide

RoomKit runs escape-room games: a **theme** is one room/game title. Everything
inside a theme is an **asset** (one table, 13 kinds): \`device\`, \`player\`,
\`website\`, \`bgm\`, \`sfx\`, \`video\`, \`dialogue\`, \`image\`, \`file\`, \`hint\`,
\`message\`, \`phase\`, \`event\`.

Core model:
- **device** — a screen/prop in the room. Devices display **websites** (via the
  \`navigate\` command) and play media.
- **player** — an audio/subtitle pairing of a speaker device + screen device.
- **phase** — a progression stage (ordered). **event** — the scenario logic:
  a trigger (device event name, manual, or system hook like \`session:start\` /
  \`phase:enter\`) plus a JSON **sequence** of commands (play media, navigate,
  switch phase, adjust timer, eval JS, end game, ...). Call \`describe_commands\`
  for the exact JSON shapes.
- **session** — one run of the game (test or production) with a countdown
  timer. Devices join a session with a device code over websockets.

## First steps in a conversation
1. \`login\` — ask the user for the server URL, admin id, and password.
2. \`select_theme\` (or \`create_theme\` then \`select_theme\`) — after this,
   theme-scoped tools no longer need \`themeId\`.
3. \`get_context\` any time you need to re-orient.

## Authoring workflow
1. \`create_theme\` (set \`timeLimitMs\` for the countdown; null = no timer).
2. Create \`device\` assets, then a \`player\` asset wiring speaker/screen devices,
   and \`website\` assets for what devices display.
3. Upload media with \`upload_file\` (local path → returns a \`fileKey\` to put in
   bgm/sfx/video/dialogue-line/image/file asset data). Media assets also work
   with \`fileKey: null\` as placeholders that simulate playback — useful for
   prototyping before real files exist.
4. Create \`phase\` assets (data.order ascending), then \`event\` assets per
   phase (or common events with \`phaseId: null\`).
5. Write sequences with \`set_event_sequence\` — it fills entry ids, validates
   the JSON, and warns about dangling asset references. Use
   \`validate_sequence\` to dry-run. \`describe_asset_kind\` documents each
   asset's data payload.

## Testing loops (fastest feedback first)
- **Virtual devices + test session** (no hardware needed):
  \`create_session\` (mode test; device codes are auto-generated) →
  \`connect_virtual_devices\` with those codes → \`control_session\`
  \`{type:"start"}\` → fire triggers with \`emit_device_trigger\` or
  \`control_session\` \`{type:"trigger_event"}\` → observe with
  \`get_session_logs\` (cursor: pass the last seen log id as afterId) and
  \`get_virtual_device_state\` (shows commands each device received).
  Virtual devices ack every command immediately, so waitUntilEnd
  completes instantly — timing is not realistic, logic is.
- **Website test** — exercises a real website in a real player window
  (requires a connected player launcher app and its playerId):
  \`create_website_test\` → \`control_website_test\` (manual commands,
  run authored events) → \`get_website_test_activity\`.
- **Full test session with the player app** — \`create_session\` with
  \`playerId\`; the launcher auto-opens a window per device.

## Gotchas
- \`update_asset\` replaces \`data\` wholesale — read first, modify, write back
  (or use the sequence tools, which do this for you).
- Sessions are created idle; nothing runs until \`control_session\`
  \`{type:"start"}\` (which fires \`session:start\` system events and arms the
  timer).
- Only one non-ended production session may exist per theme.
- \`delete_theme\` / \`delete_asset\` / \`delete_session\` are permanent — confirm
  with the user before deleting anything you did not just create.
- Media files: image/file assets are served at \`GET /api/media/{assetId}\`
  (public, stable). For other files use \`get_file_url\` (600s presigned URL).
`;
