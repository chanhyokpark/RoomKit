import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '../core/session.js';

/**
 * The skill ships inside the CLI build (dist/skill, copied by
 * scripts/copy-skill.mjs). Under tsx (dev) it falls back to the repository
 * source at skills/roomkit.
 */
export function bundledSkillDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'skill'), // dist/index.js → dist/skill
    join(here, '..', '..', '..', 'skills', 'roomkit'), // src/skill/bundled.ts → repo skills/roomkit
    join(here, '..', '..', '..', '..', 'skills', 'roomkit'),
  ];
  const found = candidates.find((dir) => existsSync(join(dir, 'SKILL.md')));
  if (!found) throw new ToolError('Bundled skill not found (dist/skill). Rebuild the CLI.', 'internal');
  return found;
}

export interface SkillMeta {
  name: string;
  description: string;
  version: string | null;
}

/** Parses the YAML-ish frontmatter of a SKILL.md (flat keys plus `metadata:` block). */
export function parseSkillFrontmatter(text: string): SkillMeta {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const meta: SkillMeta = { name: 'roomkit', description: '', version: null };
  if (!m) return meta;
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^\s*([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    const value = raw!.trim().replace(/^["']|["']$/g, '');
    if (key === 'name') meta.name = value;
    else if (key === 'description') meta.description = value;
    else if (key === 'roomkit-cli-version') meta.version = value;
  }
  return meta;
}

export function readSkillMeta(dir: string): SkillMeta | null {
  try {
    return parseSkillFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf8'));
  } catch {
    return null;
  }
}
