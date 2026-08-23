# RoomKit Documentation for AI Agents

This is the canonical documentation index returned by the RoomKit MCP `docs_list` tool. Read only the documents needed for the current task, but read the referenced contract before generating asset payloads or client code.

## Recommended sequence

1. [System model](./ai/system-model.md) — entities, ownership, state, and invariants.
2. [Architecture](./ai/architecture.md) — components, data flow, persistence, and trust boundaries.
3. [Environment and deployment](./ai/environment.md) — development and production setup.
4. [Theme authoring](./ai/authoring.md) — asset kinds, phases, events, and authoring order.
5. [Sequence commands](./ai/commands.md) — runtime behavior, waits, interpolation, and eval.
6. [Sessions and testing](./ai/sessions-testing.md) — lifecycle, virtual devices, website tests, and operations.

## Integration contracts

- [Helper integration](./ai/helper.md) — websites embedded by RoomKit Player.
- [Direct client integration](./ai/client.md) — standalone devices and custom players.
- [Hintphone integration](./ai/hintphone.md) — React/Svelte hint components and transports.
- [MCP workflows](./ai/mcp.md) — tool ordering, safe authoring, and automated test loops.
- [HTTP and Socket.io protocols](./ai/api-protocol.md) — public routes and wire behavior.
- [Troubleshooting](./ai/troubleshooting.md) — failure diagnosis by subsystem.

## Executable examples

- [`templates/hintphone`](../templates/hintphone/README.md): React hintphone using the Helper transport.
- [`templates/web`](../templates/web/README.md): React Helper site with delegated subtitle and video rendering.
- [`templates/web_custom`](../templates/web_custom/README.md): standalone React screen device using `@roomkit/client` directly.

## Documentation tool contract

- `docs_list({})` reads this file from the `master` branch.
- `docs_read({ docname })` reads a relative Markdown path below `docs/`; pass paths such as `ai/client.md` without a query or fragment.
- Documentation tools do not require RoomKit server login. Studio tools do.

The shorter Korean user documentation starts at [TOC.md](./TOC.md).
