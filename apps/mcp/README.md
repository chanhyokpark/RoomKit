# @roomkit/mcp

MCP (Model Context Protocol) server exposing RoomKit authoring and testing to
AI agents: theme/asset management, sequence (scenario) editing as JSON,
launching and observing test sessions, website tests, and headless virtual
devices. Theme archive import/export and bulk/site ZIP import remain Studio or
REST-only operations.

It is a thin client over the server's REST API (`/api/*`) plus socket.io for
virtual devices — no direct database access. For the canonical AI guide, see
[`docs/TOC_AI.md`](../../docs/TOC_AI.md). The Korean user documentation starts
at [`docs/TOC.md`](../../docs/TOC.md).

## Build

```sh
pnpm build:mcp        # from the repo root (builds @roomkit/shared first)
```

Output: `apps/mcp/dist/index.js` (self-contained ESM bundle).

## Registering with an AI client

Run the bundled package directly from GitHub without cloning the repository:

```sh
pnpm --allow-build=@roomkit/mcp dlx "github:chanhyokpark/RoomKit#path:apps/mcp"
```

No environment variables or config are needed — the agent logs in at runtime
via the `login` tool (you give it the server URL and admin credentials in the
conversation).

Claude Code:

```sh
claude mcp add roomkit -- pnpm --allow-build=@roomkit/mcp dlx "github:chanhyokpark/RoomKit#path:apps/mcp"
```

Or any client that reads `.mcp.json`-style config:

```json
{
  "mcpServers": {
    "roomkit": {
      "type": "stdio",
      "command": "pnpm",
      "args": [
        "--allow-build=@roomkit/mcp",
        "dlx",
        "github:chanhyokpark/RoomKit#path:apps/mcp"
      ]
    }
  }
}
```

For a checked-out build, use `node /path/to/RoomKit/apps/mcp/dist/index.js`.
For development without rebuilding, point the command at tsx instead:
`pnpm --dir apps/mcp exec tsx src/index.ts` (requires the workspace installed
and `@roomkit/shared` built).

## Tools (43)

- **Connection**: `login`, `select_theme`, `get_context` — stateful; after
  `select_theme`, theme-scoped tools no longer need `themeId`.
- **Documentation**: `docs_list` reads the canonical AI table of contents from
  repository `master`; `docs_read` reads a linked Markdown document. Neither
  requires RoomKit login. `get_started` and `roomkit://guide` remain aliases for
  the table of contents.
- **Discovery**: `get_started`, `describe_commands`, `describe_asset_kind`
  (self-documenting schemas; command schema is also exposed as
  `roomkit://schema/commands`).
- **Themes**: `list_themes`, `create_theme`, `update_theme`, `delete_theme`,
  `duplicate_theme`.
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

Connected Player launchers are observed by Studio's admin socket and do not
have a listing tool. A real website test therefore needs a `playerId` copied
from Player/Studio. Theme archive transfer, media ZIP import, and hosted-site
ZIP import are also not exposed by the current 43 tools.

## Smoke test

Drives the built server as a real MCP client through the whole loop
(login → author a theme → sequence with a deliberate dangling ref → test
session with a virtual device → trigger → logs → cleanup):

```sh
pnpm infra
```

In a second terminal:

```sh
pnpm --filter @roomkit/mcp build
ROOMKIT_PASSWORD=... pnpm --filter @roomkit/mcp smoke
```

Defaults: `ROOMKIT_URL=http://localhost:3000`, `ROOMKIT_ID=admin`,
`ROOMKIT_PASSWORD=roomkit`.

## Notes

- stdio transport: never `console.log` in server code (it corrupts the MCP
  stream) — diagnostics go to stderr.
- Documentation tools require outbound access to `raw.githubusercontent.com`,
  use a 10-second timeout, and intentionally follow the latest `master` docs
  rather than the installed MCP commit.
- Tool input validation is done in-process with the zod schemas from
  `@roomkit/shared`; the SDK only ever sees pre-derived JSON Schema.
- The admin JWT expires after 12h; the client re-logins automatically with
  the in-memory credentials.
