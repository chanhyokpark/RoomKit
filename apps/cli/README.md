# @roomkit/cli (`rk`)

Command-line interface for RoomKit: scaffold and deploy Player websites, and drive every Studio operation (themes, assets, sequences, sessions, virtual devices) for humans and AI agents. Human output is Korean; `--json` gives a stable machine contract. The CLI supersedes the deprecated MCP server (`apps/mcp`) and shares its saved credentials.

## Install

```sh
pnpm add -g --allow-build=@roomkit/cli "github:chanhyokpark/RoomKit#path:apps/cli"
rk login
rk init        # website project from a template
rk init ai     # theme + AI skill only, no project scaffold
```

Requires Node 22+ and pnpm 10+. `--allow-build` lets pnpm run this package's `prepare` script, which builds the single-file bundle from the cloned repository. `rk upgrade` re-runs the same command; `rk version --check` compares with `apps/cli/package.json` on master.

Documentation: [AI와 CLI 사용하기](../../docs/human/ai-and-cli.md) (Korean), [CLI reference](../../skills/roomkit/references/cli.md) (English, part of the bundled skill).

## Development

```sh
pnpm build:cli        # from the repo root (builds @roomkit/shared first)
pnpm --filter @roomkit/cli dev -- --help   # run from sources with tsx
pnpm --filter @roomkit/cli test            # unit tests (node:test)
pnpm --filter @roomkit/cli typecheck
pnpm --filter @roomkit/cli smoke           # end-to-end against a running server (see below)
```

Output: `apps/cli/dist/index.js` (self-contained ESM bundle) plus `apps/cli/dist/skill/` (copy of `skills/roomkit`, installed by `rk skill install`).

### Layout

- `src/core/` — API client, credentials, reference resolution (`key`/`code`/name → uuid), sequence ops, virtual devices, and `ops/*` (one plain function per operation). Copied from `apps/mcp/src` and maintained here.
- `src/project/` — `roomkit.json` schema and theme resolution (`--theme` > `roomkit.json` > interactive picker).
- `src/commands/` — commander commands, one module per noun.
- `src/ui/` — Korean output helpers, clack prompt wrappers gated on interactivity, JSON argument parsing.
- `src/skill/` — bundled-skill locator and per-tool install targets (Claude Code, Codex, Cursor, Gemini, Copilot, AGENTS.md).
- `src/templates/` — GitHub archive download and template extraction for `rk init`.
- `src/update/` — background version check (24h cache in `~/.roomkit/cli-update.json`).

### Smoke test

Drives the built binary through the full authoring/test loop against a running dev server, creating and deleting its own theme:

```sh
pnpm build:cli
ROOMKIT_URL=http://localhost:3000 ROOMKIT_ID=admin ROOMKIT_PASSWORD=roomkit pnpm --filter @roomkit/cli smoke
```

### Releasing

Bump `version` in `package.json` **and** `roomkit-cli-version` in `skills/roomkit/SKILL.md` (a unit test enforces they match), then push to master — installed CLIs notice the new version on their next run.
