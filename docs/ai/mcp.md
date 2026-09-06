# MCP Server Workflows

[AI documentation index](../TOC_AI.md)

RoomKit MCP is a stateful stdio client over the Server REST API plus Socket.io virtual devices. It has no direct database access. Diagnostics must use stderr because stdout carries MCP frames.

## Documentation first

Call `docs_list` without login. It reads `docs/TOC_AI.md` from repository `master`. Call `docs_read` with linked paths. `get_started` and `roomkit://guide` are compatibility aliases for the AI TOC.

## Session state inside MCP

1. `login` with user-provided server URL, ID, and password. Never guess credentials.
2. `select_theme` by UUID/name, or create then select a theme. Every other tool argument naming a theme, asset, or tag also accepts a reference instead of a uuid: assets by `key` (an optional theme-unique slug), `code` (device/hint), or unique name; tags and themes by name. References are resolved to uuids before the request; unknown or ambiguous names fail with candidates listed.
3. Use `get_context` when resuming to inspect login target, selection, virtual devices, and active sessions.

Credentials and token remain in memory. The API client automatically re-authenticates after token expiry.

## Authoring workflow

- Call `describe_asset_kind` before constructing each unfamiliar data payload.
- Call `describe_commands` before authoring sequence JSON.
- Give assets a `key` on create (`"door-screen"`, `"beep"`) and reference them by key afterwards — inside sequence JSON (`sfxId: "beep"`), asset data (`speakerDeviceId`), session tools, and every `assetId` argument. Keys are stable across renames; names are only a fallback.
- Upload media and use returned file keys; use null file keys for intentional placeholders.
- Read before update because asset data replacement is wholesale.
- For sequence changes use `get_event_sequence` with `view: "outline"` to find targets, then `edit_event_sequence` with insert/replace/update/remove/move ops addressed by entry id or index (add `in: {entryId, afterLineId}` to edit a dialogue line cue). Ops apply in order against the current state, the whole result is validated, and nothing is written if any op fails. Give inserted entries custom ids (`"open-door"`) so later edits have stable targets.
- Use `set_event_sequence` only to author or rewrite a whole sequence; it generates missing entry ids, validates the schema, preserves trigger settings, and reports dangling references.
- Treat warnings as unresolved work and re-read the saved event.
- Studio has no concurrency guard: an edit saved while someone edits the same event in Studio overwrites theirs (and vice versa).

The MCP surface does not currently wrap theme archive import/export, bulk media ZIP import, or hosted-site ZIP import. It can duplicate themes and upload individual files; use Studio or authenticated REST for the archive/ZIP-only flows. Connected launcher discovery also comes from Studio's admin socket rather than an MCP list tool, so a test session that opens real Player windows needs a `playerId` supplied from Player/Studio.

## Test workflow

Create a test session, connect virtual devices, start the session, fire triggers, and inspect both session logs and virtual device state. Pass the last log ID as `afterId` for incremental polling. Use `run_session_command` for isolated playback/navigation/message probes. List/abort session runs when a wait is stuck.

The former website-test tools were removed. To test a real website, pass `create_session` a connected `playerId` (optionally `deviceIds` for a device subset) and `urlOverrides` mapping website assets to replacement URLs such as a local dev server; the launcher opens real windows and a debug window, and the session runs the real timer, phases, and hints. Navigate manually with a `run_session_command` navigate. Virtual devices cannot validate Helper or rendering.

## Destructive operations

Theme, asset, and session deletion is permanent. Confirm before deleting anything not created as disposable work during the current task. End or clean up temporary sessions and virtual sockets. Avoid production sessions unless the user explicitly requests operation rather than authoring/testing.

## Remote documentation errors

Documentation reads use a fixed ten-second timeout and surface GitHub HTTP/network errors. The fetched `master` docs may be newer than the installed MCP binary. A document added on an unmerged branch is intentionally unavailable until merge.
