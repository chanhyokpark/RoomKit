---
name: roomkit
description: Build, deploy, author, and test RoomKit escape-room projects with the `rk` CLI — website projects (Helper), themes, assets, event sequences, sessions, and virtual devices.
metadata:
  roomkit-cli-version: "0.1.0"
  source: github:chanhyokpark/RoomKit#path:skills/roomkit
---

# RoomKit

RoomKit is an all-in-one toolkit for escape-room games: a server that runs the game logic, Studio for authoring, a Player app that drives room devices, and libraries for websites shown inside Player. The `rk` CLI is the automation surface for humans and agents; this skill documents it and the contracts behind it.

Read only the reference documents the current task needs, but read the linked contract before generating asset payloads, sequences, or client code.

## Core philosophy: all logic is server-centric

The server owns every piece of game logic — phases, timers, variables, event sequences, and command delivery. Devices are thin execution endpoints, never logic controllers:

- **Devices report, the server decides.** A device interaction (button press, puzzle input, RFID scan) fires an **event trigger** and stops there. The server matches the trigger to an event and runs its sequence.
- **Devices act only on received commands.** Effects (media, navigation, subtitles) and state changes happen because the server sent a command or **message** — not because the device decided on its own.
- **Never invert this.** Device code that orchestrates other devices belongs in a server-side event sequence; the device should fire a trigger instead. Command sequences can wait until a message was fully processed, so there is no need for a "message processed" event.

## Working with `rk`

- `rk login` once (credentials are saved to `~/.roomkit/`). Every other command auto-logs-in. `ROOMKIT_URL`/`ROOMKIT_ID`/`ROOMKIT_PASSWORD` or `--url/--id/--password` override for CI.
- The **current theme** comes from `roomkit.json` (`rk theme use <name>`, or created by `rk init`); `--theme <ref>` overrides per command. `rk status` shows login, project, theme, websites, and installed skills.
- **Always pass `--json`** when a program reads the output. Results go to stdout; errors go to stderr as `{"error":{"code","message","status?"}}`; exit codes: `0` ok, `1` runtime/API, `2` usage/missing input, `3` not logged in, `4` no theme, `130` cancelled. `--json` disables prompts, so supply every needed flag (the error names them).
- Reference assets by **`key`** (theme-unique slug set on create), never by hard-coded uuid. Themes and tags accept names. Ambiguous names fail with candidates.
- Read before update: `rk asset update --data` replaces `data` wholesale. Prefer `rk sequence edit`/`set` for event sequences (they resolve keys, generate ids, validate, and report dangling references as warnings — treat warnings as unfinished work).
- Never run `rk theme delete`, `rk asset delete`, `rk session delete`, or deploy over a live site without explicit user confirmation. Non-interactive destructive commands require `--yes`.
- `rk describe commands --json` and `rk describe asset <kind> --json` return the exact JSON Schemas; consult them before authoring payloads.

### Cheat sheet

| Task | Command |
| --- | --- |
| New website project from template | `rk init --dir site --template react --create-asset "Main screen" --asset-key main --ai claude,codex` |
| Build + deploy the website(s) in `roomkit.json` | `rk deploy` (`rk deploy <name>`, `--all`, `--no-build`) |
| Themes | `rk theme list|use|create|update|delete|duplicate|export|import` |
| Assets | `rk asset list --kind event`, `rk asset get <ref>`, `rk asset create --kind sfx --name Beep --key beep --file ./beep.mp3`, `rk asset update <ref> --data @data.json` |
| Sequences | `rk sequence get <event> --outline`, `rk sequence edit <event> --ops @ops.json`, `rk sequence set <event> --sequence @seq.json`, `rk sequence validate --sequence -` |
| Test loop | `rk session create --json` → `rk device connect --session <id> --for 5m` (background) → `rk session start <id>` → `rk device trigger <code> <event>` → `rk session logs <id>` → `rk session end <id>` |
| Operate a session | `rk session pause|resume|phase|trigger|hint|timer|command <id> ...` |
| Media | `rk upload <file> --set <assetRef>`, `rk import media sfx ./sfx.zip`, `rk file url <key>` |
| Docs | `rk docs list`, `rk docs read references/helper.md` |
| Health | `rk doctor`, `rk version --check`, `rk upgrade` |

Full command reference, `roomkit.json` schema, and workflows: [references/cli.md](./references/cli.md).

## Recommended reading order

1. [System model](./references/system-model.md) — entities, ownership, state, and invariants.
2. [Architecture](./references/architecture.md) — components, data flow, persistence, and trust boundaries.
3. [Environment and deployment](./references/environment.md) — development and production setup.
4. [Player runtime](./references/player.md) — launcher/stage behavior, caching, player test sessions and the debug window, kiosk mode, and platform limits.
5. [Theme authoring](./references/authoring.md) — asset kinds, phases, events, transfer, and authoring order.
6. [Sequence commands](./references/commands.md) — runtime behavior, waits, interpolation, and eval.
7. [Sessions and testing](./references/sessions-testing.md) — lifecycle, virtual devices, player test sessions, and operations.

## Integration contracts

- [CLI reference](./references/cli.md) — every `rk` command, output contract, `roomkit.json`.
- [Helper integration](./references/helper.md) — websites embedded by RoomKit Player (`@roomkit/helper`, `helper-react`, `helper-svelte`).
- [Direct client integration](./references/client.md) — standalone devices and custom players.
- [Hintphone integration](./references/hintphone.md) — React/Svelte hint components and transports.
- [HTTP and Socket.io protocols](./references/api-protocol.md) — public routes and wire behavior.
- [Troubleshooting](./references/troubleshooting.md) — failure diagnosis by subsystem.

## Executable examples

- `templates/web` (React) and `templates/web_svelte` (SvelteKit) in the RoomKit repository — what `rk init` scaffolds.
- `templates/web_custom` — standalone React screen device using `@roomkit/client` directly.

## Keeping this skill current

This directory is installed and overwritten by `rk skill install` (also run by `rk init`). Do not edit it by hand; `rk skill status` reports when it lags the installed CLI. The latest master copy is readable with `rk docs list --remote` / `rk docs read <path> --remote`.
