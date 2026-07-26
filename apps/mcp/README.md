# @roomkit/mcp

MCP (Model Context Protocol) server exposing the full RoomKit studio feature
set to AI agents: theme/asset management, sequence (scenario) editing as JSON,
launching and observing test sessions, website tests, and headless virtual
devices.

It is a thin client over the server's REST API (`/api/*`) plus socket.io for
virtual devices — no direct database access. For the user-facing guide, see
[`docs/AI.md`](../../docs/AI.md).

## Build

```sh
pnpm build:mcp        # from the repo root (builds @roomkit/shared first)
```

Output: `apps/mcp/dist/index.js` (self-contained ESM bundle).

## Registering with an AI client

No environment variables or config are needed — the agent logs in at runtime
via the `login` tool (you give it the server URL and admin credentials in the
conversation).

Claude Code:

```sh
claude mcp add roomkit -- node /path/to/RoomKit/apps/mcp/dist/index.js
```

Or any client that reads `.mcp.json`-style config:

```json
{
  "mcpServers": {
    "roomkit": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/RoomKit/apps/mcp/dist/index.js"]
    }
  }
}
```

For development without rebuilding, point the command at tsx instead:
`pnpm --dir apps/mcp exec tsx src/index.ts` (requires the workspace installed
and `@roomkit/shared` built).

## Tools (38)

- **Connection**: `login`, `select_theme`, `get_context` — stateful; after
  `select_theme`, theme-scoped tools no longer need `themeId`.
- **Discovery**: `get_started`, `describe_commands`, `describe_asset_kind`
  (self-documenting schemas; also exposed as `roomkit://guide` and
  `roomkit://schema/commands` resources).
- **Themes**: `list/create/update/delete/duplicate_theme`.
- **Tags**: `list_tags`, `manage_tag`.
- **Assets**: `list_assets` (token-lean summaries), `get_asset`,
  `create_asset`, `update_asset`, `delete_asset`.
- **Uploads**: `upload_file` (local path → presigned S3 PUT → `fileKey`),
  `get_file_url`.
- **Sequences**: `get_event_sequence`, `set_event_sequence` (auto entry ids,
  schema validation, dangling-ref warnings, preserves trigger config),
  `validate_sequence`.
- **Sessions**: `create_session` (auto-generates test device codes),
  `control_session`, `run_session_command` (one-off sequence command — the
  operation console's backend), `list_session_runs`, `abort_session_run`,
  `list_sessions`, `get_session`, `get_session_summary`, `get_session_logs`,
  `delete_session`.
- **Website test**: `create_website_test`, `list_website_tests`,
  `control_website_test`, `get_website_test_activity`.
- **Virtual devices**: `connect_virtual_devices`, `get_virtual_device_state`,
  `emit_device_trigger`, `disconnect_virtual_devices` — headless socket.io
  devices that ack every command immediately, enabling full test loops with
  no player app or hardware.

## Smoke test

Drives the built server as a real MCP client through the whole loop
(login → author a theme → sequence with a deliberate dangling ref → test
session with a virtual device → trigger → logs → cleanup):

```sh
./compose.sh && pnpm dev:server        # infra + server
pnpm --filter @roomkit/mcp build
ROOMKIT_PASSWORD=... pnpm --filter @roomkit/mcp smoke
```

Defaults: `ROOMKIT_URL=http://localhost:3000`, `ROOMKIT_ID=admin`,
`ROOMKIT_PASSWORD=roomkit`.

## Notes

- stdio transport: never `console.log` in server code (it corrupts the MCP
  stream) — diagnostics go to stderr.
- Tool input validation is done in-process with the zod schemas from
  `@roomkit/shared`; the SDK only ever sees pre-derived JSON Schema.
- The admin JWT expires after 12h; the client re-logins automatically with
  the in-memory credentials.
