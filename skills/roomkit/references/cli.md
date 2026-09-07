# `rk` CLI Reference

[RoomKit skill](../SKILL.md) · [Theme authoring](./authoring.md) · [Sessions and testing](./sessions-testing.md)

`rk` is a single-file Node.js CLI (`@roomkit/cli`, `apps/cli` in the RoomKit repository). It is a thin client over the server REST API plus socket.io virtual devices, the successor of the deprecated MCP server (`apps/mcp`), and shares its saved credentials.

## Install and upgrade

```sh
pnpm add -g --allow-build=@roomkit/cli "github:chanhyokpark/RoomKit#path:apps/cli"
rk version --check   # compares with apps/cli/package.json on master
rk upgrade           # re-runs the install command (add --ref <branch|tag|sha> to pin)
```

Requires Node 22+ and pnpm 10+. The CLI checks for a newer version in the background (24 h cache in `~/.roomkit/cli-update.json`) and prints a one-line notice on stderr; disable with `--no-update-check` or `ROOMKIT_NO_UPDATE_CHECK=1`.

## Output and exit contract

- Human output is Korean and goes to stdout; warnings go to stderr.
- `--json`: the result object/array is printed to stdout as JSON (with a `warnings` array when non-fatal notices occurred). Errors are printed to stderr as `{"error":{"code":"...","message":"...","status":404,"details":...}}`. Streaming commands (`rk device connect`, `rk session logs --follow`) print one JSON object per line (NDJSON).
- Exit codes: `0` success · `1` runtime/API error · `2` usage error, invalid input, missing input for a non-interactive run, invalid `roomkit.json` · `3` not logged in · `4` no theme selected · `130` cancelled.
- Prompts appear only on a TTY without `--json`/`--yes`/`CI`. Otherwise a missing answer fails with `missing_input` and the error message lists the flags that would have answered it.
- Destructive commands (`theme delete`, `asset delete`, `session delete`) confirm on a TTY and require `--yes` (`-y`, `--no-input`) elsewhere. `rk theme use` / `--use` create a missing `roomkit.json` at cwd after confirming on a TTY (silently otherwise).

### Global options

| Flag | Meaning |
| --- | --- |
| `--json` | Machine-readable output, no prompts |
| `-y, --yes` / `--no-input` | Skip confirmations and prompts |
| `-t, --theme <ref>` | Theme (uuid or name) for this command, overriding `roomkit.json` |
| `-p, --project <path>` | `roomkit.json` file or directory (default: nearest one above cwd) |
| `--url <url> --id <id> --password <pw>` | Credentials for this run only (all three); same as `ROOMKIT_URL`/`ROOMKIT_ID`/`ROOMKIT_PASSWORD` |
| `--no-update-check` | Skip the background version check |

### JSON arguments

Options that take JSON (`--data`, `--sequence`, `--ops`, `--op`, `--command`, `--payload`) accept inline JSON, `@path/to/file.json`, or `-` for stdin.

## Login and state

| Command | Notes |
| --- | --- |
| `rk login [--no-save]` | Prompts for server URL, admin id, password (or takes `--url/--id/--password`). Saves to `~/.roomkit/mcp-credentials.json` (mode 600, shared with the MCP server). Lists themes. |
| `rk logout` | Deletes the saved credentials. |
| `rk whoami` | Server and admin id. |
| `rk status` | Login, project root, theme, websites, AI tools, installed skill versions, active sessions. |
| `rk doctor` | Node/pnpm, credentials, server reachability, `roomkit.json`, website directories, skill versions, update. Non-zero exit when a check fails. |

Every other command logs in automatically with the saved credentials and re-logs-in once when the JWT expires.

## `roomkit.json`

Lives at the project root (committed; contains no secrets). Found by walking up from the current directory.

```json
{
  "version": 1,
  "server": "http://localhost:3000",
  "theme": { "id": "<uuid>", "name": "Stella" },
  "websites": [
    { "name": "main", "dir": ".", "assetId": "<uuid>", "assetKey": "main", "build": "pnpm build", "dist": "dist" }
  ],
  "ai": { "tools": ["claude", "codex"] }
}
```

- `server`: the server the theme id belongs to. A different login target produces a warning.
- `theme`: the current theme for every theme-scoped command (`rk theme use` writes it).
- `websites[]`: deploy targets. `dir` is relative to the file (`.` for a single-package project, `apps/site` in a monorepo); `build` runs in `dir` (`null` = no build); `dist` is relative to `dir` and must contain `index.html` at its root.
- `ai.tools`: which AI tools `rk skill install` targets (`claude`, `codex`, `cursor`, `gemini`, `copilot`, `agents`).

## Projects: `init`, `deploy`, `skill`

### `rk init`

Interactive wizard (every step has a flag for non-interactive use):

```sh
rk init [--dir <path>] [--template react|svelte] \
        [--theme <ref> | --create-theme <name> [--time-limit 60m]] \
        [--asset <ref> | --create-asset <name> [--asset-key <slug>] | --no-asset] \
        [--name <pkgName>] [--ref master] [--install | --no-install] \
        [--ai claude,codex | --ai ""] [--force]
```

1. Target directory (must be empty unless `--force`). If a `roomkit.json` exists above it, the website is added to that project with a relative `dir`.
2. Login if needed.
3. Theme: pick, keep the project theme, or create.
4. Website asset: pick an existing `website` asset, create one (`{mode:"external", url:"http://localhost:5173"}` placeholder that the first `rk deploy` switches to hosted), or skip.
5. Template: `web` (Vite + React + Tailwind, `@roomkit/helper-react`, dist `dist/`) or `web_svelte` (SvelteKit static, `@roomkit/helper-svelte`, dist `build/`). Downloaded from the RoomKit repository zip at `--ref` (default `master`) — network required.
6. `package.json` name rewrite, optional `pnpm install`.
7. AI tools → skill install (see below).
8. Writes/merges `roomkit.json` (`server`, `theme`, `websites`, `ai.tools`).

Then: `pnpm dev` and point the Player test tab's "website URL override" at the dev server; `rk deploy` when ready.

### `rk deploy`

```sh
rk deploy                    # the only entry, or a multiselect on a TTY
rk deploy main admin --no-build
rk deploy --all
rk deploy --dir . --asset main --dist dist [--build-command "pnpm build"] [--save --name main]
```

Per entry: run `build` in `dir` → zip `dist` (must contain `index.html`; `.DS_Store`/`__MACOSX` skipped) → `POST /api/themes/:id/imports/site` → `PATCH` the website asset to `{mode:"hosted", sitePrefix}`. The site is served at `{server}/api/sites/{assetId}/` (stable URL; the previous upload stays in storage unreferenced). JSON output: `{deployed:[{name, assetId, url, fileCount}], failed:[{name, error}]}`; exit 1 when any entry failed.

### `rk skill`

```sh
rk skill install [--tools claude,codex]   # default: roomkit.json ai.tools, else a multiselect
rk skill status
rk skill remove [--tools ...]
rk skill list
```

Project-scoped only. Targets and what they write (all rk-owned; re-install overwrites):

| Tool | Files |
| --- | --- |
| `claude` | `.claude/skills/roomkit/` (SKILL.md + references) — Claude Code's project skill directory |
| `codex` | `.agents/skills/roomkit/` + managed block in `AGENTS.md` — Codex scans `.agents/skills` from cwd up to the repo root |
| `cursor` | `.agents/skills/roomkit/` + managed block in `AGENTS.md` — Cursor loads `.agents/skills`, `.cursor/skills`, `.claude/skills` and reads `AGENTS.md` |
| `agents` | `.agents/skills/roomkit/` + managed block in `AGENTS.md` — any AGENTS.md-aware agent |
| `gemini` | `.agents/skills/roomkit/` + managed block in `GEMINI.md` — Gemini CLI treats `.agents/skills/` as an alias of `.gemini/skills/` |
| `copilot` | `.agents/skills/roomkit/` + managed block in `.github/copilot-instructions.md` — Copilot scans `.github/skills`, `.claude/skills`, `.agents/skills` |

Managed blocks are delimited by `<!-- roomkit-skill:start version=X -->` … `<!-- roomkit-skill:end -->`; text outside them is never touched. The `.agents/skills/roomkit` copy is shared by every non-Claude target and removed only when the last of them is removed.

## Authoring

### Themes

`rk theme list` · `rk theme use [ref]` · `rk theme get [ref]` · `rk theme create <name> [--time-limit 60m|none] [--use]` · `rk theme update [ref] [--name] [--time-limit]` · `rk theme delete <ref>` · `rk theme duplicate [ref] [--name] [--use]` · `rk theme export [ref] [-o file.zip]` · `rk theme import <zip> [--use]`

`[ref]` defaults to the project theme. `delete` always needs an explicit ref.

### Tags

`rk tag list` · `rk tag create <name> --color <css>` · `rk tag update <ref> [--name] [--color]` · `rk tag delete <ref>`

### Assets

```sh
rk asset list [--kind <kind>] [--tag <ref>] [--search <text>] [--data]
rk asset get <ref>
rk asset create                       # wizard on a TTY
rk asset create --kind device --name "Door screen" --key door --code DOOR-1
rk asset create --kind sfx --name Beep --key beep --file ./beep.mp3
rk asset create --kind website --name Main --key main --website-url http://localhost:5173
rk asset create --kind event --name "Open door" --key open-door --data @event.json
rk asset update <ref> [--name] [--key <key>|--key ""] [--code] [--description] [--tag <ref>...] [--data <json>]
rk asset delete <ref>
```

- `<ref>` = uuid, `key`, `code` (device/hint), or unique name. Kind-scoped fields (e.g. a `sfxId`) reject matches of another kind.
- Without `--data`, non-interactive `create` uses placeholder defaults for device/event/media/message/dialogue/phase; `website`, `player`, and `hint` need `--data` (or `--website-url`/`--file`). `rk describe asset <kind> --json` gives the exact schema.
- References inside `data` (player `speakerDeviceId`/`screenDeviceId`, event `phaseId`, device `startWebsite.websiteId`) and `--tag` accept keys/names.
- `update --data` is a full replacement. `--key ""` clears the key.

### Files and media

`rk upload <file> [--content-type <type>] [--set <mediaAssetRef>]` → `{key, size, contentType}` · `rk file url <key>` → temporary download URL · `rk import media bgm|sfx|video|dialogue <zip>` → bulk-created assets.

### Sequences

```sh
rk sequence get <event> [--outline]
rk sequence set <event> --sequence @seq.json
rk sequence edit <event> --ops @ops.json | --op '{"op":"insert","command":{...},"id":"open-door"}' ...
rk sequence validate --sequence -
```

- `get --outline` prints one line per entry (`[index] id=… type … refs…`) — the cheap way to find edit targets.
- `edit` ops: `insert` (`command`, `id?`, `at|before|after?`), `replace` (`target`, `command`), `update` (`target`, `patch`; same type), `remove` (`target`), `move` (`target`, `at|before|after`). `target` is an entry id or 0-based index against the sequence *after* the previous ops. Add `in: {entryId, afterLineId}` to edit inside a `playDialogue` line cue (insert creates the cue). Nothing is written if any op or validation fails.
- `set` replaces the whole sequence, keeps trigger config, generates missing ids.
- All three report `warnings` for null/dangling/mis-kinded references — the runtime silently skips such commands.

## Sessions and devices

```sh
rk session create [--mode test|production] [--device-code <deviceRef>=<code>]... [--player <launcherId>] [--devices a,b] [--url-override <websiteRef>=<url>]... [--start]
rk session start|pause|resume|end|restart-phase|reset-devices <id>
rk session timer <id> --delta 5m | --pause | --resume
rk session phase <id> <phaseRef>
rk session trigger <id> <eventRef>            # manual-triggerable events
rk session hint <id> <hintRef> [--step n]
rk session command <id> --command '{"type":"navigate",...}'   # one-off command; watch logs
rk session runs <id>  ·  rk session abort <id> <runId>
rk session list [--active] [--all-themes]  ·  rk session get <id>  ·  rk session summary <id>  ·  rk session delete <id>
rk session logs <id> [--after <logId>] [--limit 500] [--follow --interval 1000]
```

`create` in test mode without `--device-code`/`--player` mints an `rk-…` code per device asset and returns `generatedDeviceCodes`.

```sh
rk device connect --session <id> | --code <c>... [--for 5m] [--until-end]   # foreground; streams received commands
rk device trigger <code> <event> [--payload '{"x":1}'] [--no-wait] [--timeout 15000]
```

Virtual devices live only inside the `rk device connect` process: it acks every command immediately (logic-accurate, timing-unrealistic) and exits on Ctrl-C, `--for`, or `--until-end`. `rk device trigger` opens a transient second socket for the same code, fires the trigger, waits for the started event runs to finish (unless `--no-wait`), and disconnects — run it while `connect` is active so the session's device stays online. With `--json`, `connect` prints NDJSON: `{"type":"connected",...}`, `{"type":"event","code","direction","event","payload","at"}`, `{"type":"disconnected",...}`.

### Typical automated test loop

```sh
S=$(rk session create --json | jq -r .session.id)
CODE=$(rk session get $S --json | jq -r '.testDeviceCodes[0].code')
rk device connect --session $S --until-end --json > devices.ndjson &
rk session start $S --json
rk device trigger $CODE button:press --json
rk session logs $S --json
rk session end $S --json
```

## Docs and schemas

`rk docs list [--remote]` (SKILL.md + file list) · `rk docs read references/helper.md [--remote]` · `rk describe commands [--json]` · `rk describe asset <kind> [--json]`

`--remote` reads `skills/roomkit/` from the repository's `master` branch instead of the copy bundled with the installed CLI.
