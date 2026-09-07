// Bundles the roomkit Agent Skill (skills/roomkit) into dist/skill so `rk`
// can install it into projects. The skill documents this CLI's commands, so
// it ships with the CLI instead of being fetched separately.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, '..', '..', 'skills', 'roomkit');
const dest = join(root, 'dist', 'skill');

if (!existsSync(join(source, 'SKILL.md'))) {
  console.error(`copy-skill: ${source}/SKILL.md not found`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });
console.log(`copy-skill: ${source} -> ${dest}`);
