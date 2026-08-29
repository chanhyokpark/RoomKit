# RoomKit Documentation for AI Agents

This is the canonical documentation index returned by the RoomKit MCP `docs_list` tool. Read only the documents needed for the current task, but read the referenced contract before generating asset payloads or client code.

## Core philosophy: all logic is server-centric

The server owns every piece of game logic — phases, timers, variables, event sequences, and command delivery. Devices are thin execution endpoints, never logic controllers:

- **Devices report, the server decides.** When a user interacts with a device (button press, puzzle input, RFID scan), the device fires an **event trigger** and stops there. The server matches the trigger to an event and runs its sequence.
- **Devices act only on received commands.** Effects (playing media, navigating, showing subtitles) and state changes happen because the server sent a command or **message** to the device — not because the device decided on its own.
- **Never invert this.** A device must not act as the main logic handler that calls the server to control other devices or play media elsewhere. If you find yourself writing device code that orchestrates other devices, move that logic into a server-side event sequence and have the device fire a trigger instead.

This keeps every session reproducible, observable, and controllable from the server (and Studio), regardless of which devices are connected.

## Recommended sequence

1. [System model](./ai/system-model.md) — entities, ownership, state, and invariants.
2. [Architecture](./ai/architecture.md) — components, data flow, persistence, and trust boundaries.
3. [Environment and deployment](./ai/environment.md) — development and production setup.
4. [Player runtime](./ai/player.md) — launcher/stage behavior, caching, player test sessions and the debug window, kiosk mode, and platform limits.
5. [Theme authoring](./ai/authoring.md) — asset kinds, phases, events, transfer, and authoring order.
6. [Sequence commands](./ai/commands.md) — runtime behavior, waits, interpolation, and eval.
7. [Sessions and testing](./ai/sessions-testing.md) — lifecycle, virtual devices, player test sessions, and operations.

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
