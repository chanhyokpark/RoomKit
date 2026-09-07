import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { AiTool } from '../project/config.js';
import { bundledSkillDir, readSkillMeta } from './bundled.js';
import { AGENTS_SKILL_DIR, SKILL_TARGETS, type TargetStatus } from './targets.js';

export interface InstallReport {
  tool: AiTool;
  version: string;
  paths: string[];
}

/** Installs the bundled skill for each tool into the project root (project-scoped only). */
export function installSkill(root: string, tools: AiTool[]): InstallReport[] {
  const skillDir = bundledSkillDir();
  const version = readSkillMeta(skillDir)?.version ?? 'unknown';
  return tools.map((tool) => ({ tool, version, paths: SKILL_TARGETS[tool].install({ root, skillDir, version }) }));
}

export function skillStatus(root: string, tools: AiTool[]): TargetStatus[] {
  return tools.map((tool) => SKILL_TARGETS[tool].status(root));
}

export function removeSkill(root: string, tools: AiTool[], remaining: AiTool[]): string[] {
  const touched = tools.flatMap((tool) => SKILL_TARGETS[tool].remove(root));
  // Drop the shared copy once no block-based target remains.
  const sharesCopy = (t: AiTool) => t !== 'claude';
  if (!remaining.some(sharesCopy) && existsSync(join(root, AGENTS_SKILL_DIR))) {
    rmSync(join(root, AGENTS_SKILL_DIR), { recursive: true, force: true });
    touched.push(AGENTS_SKILL_DIR);
  }
  return touched;
}

export function bundledSkillVersion(): string | null {
  return readSkillMeta(bundledSkillDir())?.version ?? null;
}
