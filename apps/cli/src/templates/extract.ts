import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { unzip } from 'fflate';
import { ToolError } from '../core/session.js';

/** Files that never belong in a generated project. */
const SKIP = new Set(['.DS_Store', 'node_modules', 'dist', 'build', '.svelte-kit', 'pnpm-lock.yaml']);

/**
 * Extracts `templates/<name>/**` from a GitHub repository zip into `dest`.
 * The archive's single wrapping folder (`RoomKit-<ref>/`) is detected from
 * the entry names rather than assumed, so any ref works.
 */
export async function extractTemplate(zip: Uint8Array, name: string, dest: string): Promise<string[]> {
  const prefixOf = (entry: string) => `${entry.split('/')[0]}/templates/${name}/`;
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
    unzip(
      zip,
      {
        filter: (file) => {
          const prefix = prefixOf(file.name);
          if (!file.name.startsWith(prefix) || file.name.endsWith('/')) return false;
          const rel = file.name.slice(prefix.length);
          return !rel.split('/').some((seg) => SKIP.has(seg));
        },
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
  const written: string[] = [];
  for (const [entry, data] of Object.entries(files)) {
    const rel = entry.slice(prefixOf(entry).length);
    if (!rel || rel.split('/').some((seg) => seg === '..')) continue;
    const target = join(dest, ...rel.split(posix.sep));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    written.push(rel);
  }
  if (!written.length) throw new ToolError(`아카이브에 templates/${name} 이 없습니다.`, 'not_found');
  return written.sort();
}

export function isDirEmpty(dir: string): boolean {
  try {
    return readdirSync(dir).filter((f) => f !== '.DS_Store').length === 0;
  } catch {
    return true;
  }
}
