import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { ToolError } from '../core/session.js';

export const CONFIG_FILENAME = 'roomkit.json';

export const AI_TOOL_IDS = ['claude', 'codex', 'cursor', 'gemini', 'copilot', 'agents'] as const;
export const AiToolSchema = z.enum(AI_TOOL_IDS);
export type AiTool = z.infer<typeof AiToolSchema>;

export const WebsiteEntrySchema = z.object({
  /** Short handle used by `rk deploy <name>`. */
  name: z.string().min(1),
  /** Project directory relative to roomkit.json ('.' when not a monorepo). */
  dir: z.string().min(1),
  /** Website asset uuid in the project theme. */
  assetId: z.uuid(),
  /** Asset key at the time of linking (display / fallback only). */
  assetKey: z.string().nullable().optional(),
  /** Shell command run in `dir` before zipping; null = no build step. */
  build: z.string().nullable().optional(),
  /** Build output directory relative to `dir`. */
  dist: z.string().min(1),
});
export type WebsiteEntry = z.infer<typeof WebsiteEntrySchema>;

export const RoomkitConfigSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    /** Server origin the theme id belongs to (theme ids are per server). */
    server: z.string().optional(),
    theme: z.object({ id: z.uuid(), name: z.string() }).optional(),
    websites: z.array(WebsiteEntrySchema).default([]),
    ai: z.object({ tools: z.array(AiToolSchema).default([]) }).optional(),
  })
  .passthrough();
export type RoomkitConfig = z.infer<typeof RoomkitConfigSchema>;

export interface ProjectHandle {
  /** Directory containing roomkit.json. */
  root: string;
  path: string;
  config: RoomkitConfig;
}

/** Walk up from `start` to the nearest roomkit.json. */
export function findProjectRoot(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILENAME))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadProject(root: string): ProjectHandle {
  const path = join(root, CONFIG_FILENAME);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new ToolError(`Cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`, 'bad_config');
  }
  const parsed = RoomkitConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ToolError(`${path} is invalid:\n${z.prettifyError(parsed.error)}`, 'bad_config');
  }
  return { root, path, config: parsed.data };
}

/**
 * Locate and load the project: explicit path (file or directory) wins,
 * otherwise the nearest roomkit.json above cwd. Null when none exists.
 */
export function findProject(explicit?: string, cwd: string = process.cwd()): ProjectHandle | null {
  if (explicit) {
    const abs = resolve(cwd, explicit);
    const root = abs.endsWith(CONFIG_FILENAME) ? dirname(abs) : abs;
    if (!existsSync(join(root, CONFIG_FILENAME))) {
      throw new ToolError(`No ${CONFIG_FILENAME} at ${root}`, 'no_project');
    }
    return loadProject(root);
  }
  const root = findProjectRoot(cwd);
  return root ? loadProject(root) : null;
}

export function emptyConfig(): RoomkitConfig {
  return { version: 1, websites: [] };
}

/** Writes roomkit.json, keeping a stable key order for readable diffs. */
export function saveProject(root: string, config: RoomkitConfig): ProjectHandle {
  const { $schema, version, server, theme, websites, ai, ...rest } = config;
  const ordered = {
    ...($schema && { $schema }),
    version,
    ...(server && { server }),
    ...(theme && { theme }),
    websites,
    ...(ai && { ai }),
    ...rest,
  };
  const path = join(root, CONFIG_FILENAME);
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`);
  return { root, path, config: RoomkitConfigSchema.parse(ordered) };
}

/** Adds or replaces (by name) a website entry. */
export function upsertWebsite(config: RoomkitConfig, entry: WebsiteEntry): RoomkitConfig {
  const websites = config.websites.filter((w) => w.name !== entry.name);
  websites.push(entry);
  return { ...config, websites };
}
