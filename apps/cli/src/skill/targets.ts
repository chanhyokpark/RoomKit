import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AiTool } from '../project/config.js';
import { readSkillMeta } from './bundled.js';
import { readBlockVersion, removeManagedBlock, upsertManagedBlock } from './managed-block.js';

/**
 * Where each AI tool discovers project-scoped skills and instructions.
 * Verified against vendor documentation on 2026-09-06 — this table is the
 * only place paths live:
 *
 * - Claude Code: `.claude/skills/<name>/SKILL.md` (code.claude.com/docs/en/skills).
 * - Codex: `.agents/skills` in cwd, its ancestors, and the repo root
 *   (developers.openai.com/codex/skills); AGENTS.md for instructions.
 * - Gemini CLI: workspace skills in `.gemini/skills/` or the `.agents/skills/`
 *   alias (geminicli.com/docs/cli/skills); GEMINI.md context file.
 * - Cursor: `.agents/skills/`, `.cursor/skills/`, plus `.claude/skills/` and
 *   `.codex/skills/` (cursor.com/docs/context/skills); AGENTS.md supported.
 * - GitHub Copilot: `.github/skills`, `.claude/skills`, `.agents/skills`
 *   (docs.github.com "about agent skills"); `.github/copilot-instructions.md`
 *   and AGENTS.md for instructions.
 * - agentskills.io recommends `<project>/.agents/skills/` for cross-client
 *   interoperability; `name` must equal the directory name (`roomkit`).
 */
export const CLAUDE_SKILL_DIR = join('.claude', 'skills', 'roomkit');
/** Agent Skills cross-client location (Codex, Gemini CLI, Cursor, Copilot). */
export const AGENTS_SKILL_DIR = join('.agents', 'skills', 'roomkit');
export const AGENTS_MD = 'AGENTS.md';
export const GEMINI_MD = 'GEMINI.md';
export const COPILOT_INSTRUCTIONS = join('.github', 'copilot-instructions.md');

export interface InstallInput {
  root: string;
  skillDir: string;
  version: string;
}

export interface TargetStatus {
  tool: AiTool;
  installed: boolean;
  version: string | null;
  paths: string[];
}

export interface SkillTarget {
  id: AiTool;
  label: string;
  hint: string;
  /** Returns the project-relative paths written. */
  install(input: InstallInput): string[];
  status(root: string): TargetStatus;
  /** Returns the project-relative paths removed/edited. */
  remove(root: string): string[];
}

/** Instruction-file body pointing agents at the skill (English: agent-facing). */
export function instructionBody(skillPath: string): string {
  return [
    '## RoomKit',
    '',
    `This project uses RoomKit (escape-room toolkit) and the \`rk\` CLI. Before any RoomKit-related work, read \`${skillPath}/SKILL.md\` and the reference documents it links.`,
    '',
    '- Run `rk --json ...` for machine-readable output; errors arrive on stderr as `{"error":{"code","message"}}` with a non-zero exit code.',
    '- The current theme and deploy targets come from `roomkit.json` (`rk status`). Do not hard-code theme or asset uuids; reference assets by `key`.',
    '- Never run destructive commands (`rk theme delete`, `rk asset delete`, `rk session delete`, deploying over a live site) without explicit user confirmation.',
    '- Keep game logic server-side (event sequences); websites only report triggers and act on received messages.',
  ].join('\n');
}

function copySkill(root: string, rel: string, skillDir: string): string {
  const dest = join(root, rel);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(skillDir, dest, { recursive: true });
  return rel;
}

function dirStatus(root: string, rel: string): { installed: boolean; version: string | null } {
  const meta = readSkillMeta(join(root, rel));
  return { installed: meta !== null, version: meta?.version ?? null };
}

function upsertFile(root: string, rel: string, body: string, version: string): string {
  const path = join(root, rel);
  const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, upsertManagedBlock(current, body, version));
  return rel;
}

function fileBlockVersion(root: string, rel: string): string | null {
  const path = join(root, rel);
  return existsSync(path) ? readBlockVersion(readFileSync(path, 'utf8')) : null;
}

function removeBlock(root: string, rel: string): string[] {
  const path = join(root, rel);
  if (!existsSync(path)) return [];
  const next = removeManagedBlock(readFileSync(path, 'utf8'));
  if (next) writeFileSync(path, next);
  else rmSync(path);
  return [rel];
}

function removeDir(root: string, rel: string): string[] {
  const path = join(root, rel);
  if (!existsSync(path)) return [];
  rmSync(path, { recursive: true, force: true });
  return [rel];
}

/** Targets that share the canonical `.agents/skills/roomkit` copy plus one instruction file. */
function blockTarget(id: AiTool, label: string, hint: string, file: string): SkillTarget {
  return {
    id,
    label,
    hint,
    install({ root, skillDir, version }) {
      return [copySkill(root, AGENTS_SKILL_DIR, skillDir), upsertFile(root, file, instructionBody(AGENTS_SKILL_DIR.split('\\').join('/')), version)];
    },
    status(root) {
      const dir = dirStatus(root, AGENTS_SKILL_DIR);
      const block = fileBlockVersion(root, file);
      return { tool: id, installed: dir.installed && block !== null, version: block ?? dir.version, paths: [AGENTS_SKILL_DIR, file] };
    },
    remove(root) {
      // The shared copy stays if another block target is still installed.
      return removeBlock(root, file);
    },
  };
}

const claude: SkillTarget = {
  id: 'claude',
  label: 'Claude Code',
  hint: '.claude/skills/roomkit/',
  install({ root, skillDir }) {
    return [copySkill(root, CLAUDE_SKILL_DIR, skillDir)];
  },
  status(root) {
    return { tool: 'claude', ...dirStatus(root, CLAUDE_SKILL_DIR), paths: [CLAUDE_SKILL_DIR] };
  },
  remove(root) {
    return removeDir(root, CLAUDE_SKILL_DIR);
  },
};

const codex = blockTarget('codex', 'Codex', '.agents/skills/roomkit/ + AGENTS.md', AGENTS_MD);
const cursor = blockTarget('cursor', 'Cursor', '.agents/skills/roomkit/ + AGENTS.md', AGENTS_MD);
const agents = blockTarget('agents', 'AGENTS.md (범용)', '.agents/skills/roomkit/ + AGENTS.md', AGENTS_MD);
const gemini = blockTarget('gemini', 'Gemini CLI', '.agents/skills/roomkit/ + GEMINI.md', GEMINI_MD);
const copilot = blockTarget('copilot', 'GitHub Copilot', '.agents/skills/roomkit/ + .github/copilot-instructions.md', COPILOT_INSTRUCTIONS);

export const SKILL_TARGETS: Record<AiTool, SkillTarget> = { claude, codex, cursor, gemini, copilot, agents };
