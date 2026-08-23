# MCP Server Workflows

[AI documentation index](../TOC_AI.md)

RoomKit MCP is a stateful stdio client over the Server REST API plus Socket.io virtual devices. It has no direct database access. Diagnostics must use stderr because stdout carries MCP frames.

## Documentation first

Call `docs_list` without login. It reads `docs/TOC_AI.md` from repository `master`. Call `docs_read` with linked paths. `get_started` and `roomkit://guide` are compatibility aliases for the AI TOC.

## Session state inside MCP

1. `login` with user-provided server URL, ID, and password. Never guess credentials.
2. `select_theme` by UUID/name, or create then select a theme.
3. Use `get_context` when resuming to inspect login target, selection, virtual devices, and active sessions.

Credentials and token remain in memory. The API client automatically re-authenticates after token expiry.

## Authoring workflow

- Call `describe_asset_kind` before constructing each unfamiliar data payload.
- Call `describe_commands` before authoring sequence JSON.
- Upload media and use returned keys; use null keys for intentional placeholders.
- Read before update because asset data replacement is wholesale.
- Prefer `set_event_sequence`; it fills entry UUIDs, validates schema, preserves trigger settings, and reports dangling references.
- Treat warnings as unresolved work and re-read the saved event.

## Test workflow

Create a test session, connect virtual devices, start the session, fire triggers, and inspect both session logs and virtual device state. Pass the last log ID as `afterId` for incremental polling. Use `run_session_command` for isolated playback/navigation/message probes. List/abort session runs when a wait is stuck.

Website tests require a connected Player ID and real window. Create a website test, issue commands or authored events, and inspect activity. Virtual devices cannot validate Helper or rendering.

## Destructive operations

Theme, asset, and session deletion is permanent. Confirm before deleting anything not created as disposable work during the current task. End or clean up temporary sessions and virtual sockets. Avoid production sessions unless the user explicitly requests operation rather than authoring/testing.

## Remote documentation errors

Documentation reads use a fixed ten-second timeout and surface GitHub HTTP/network errors. The fetched `master` docs may be newer than the installed MCP binary. A document added on an unmerged branch is intentionally unavailable until merge.
