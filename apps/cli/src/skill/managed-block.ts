const START = (version: string) => `<!-- roomkit-skill:start version=${version} -->`;
const END = '<!-- roomkit-skill:end -->';
const BLOCK_RE = /<!-- roomkit-skill:start(?: version=([^\s>]+))? -->[\s\S]*?<!-- roomkit-skill:end -->/;

/**
 * Inserts or replaces the rk-managed section of an instruction file
 * (AGENTS.md, GEMINI.md, ...). Text outside the markers is never touched;
 * a missing block is appended after a blank line.
 */
export function upsertManagedBlock(source: string, body: string, version: string): string {
  const block = `${START(version)}\n${body.trim()}\n${END}`;
  if (BLOCK_RE.test(source)) return source.replace(BLOCK_RE, block);
  if (!source.trim()) return `${block}\n`;
  return `${source.replace(/\s+$/, '')}\n\n${block}\n`;
}

export function removeManagedBlock(source: string): string {
  if (!BLOCK_RE.test(source)) return source;
  const stripped = source.replace(BLOCK_RE, '').replace(/\n{3,}/g, '\n\n');
  return stripped.trim() ? `${stripped.replace(/\s+$/, '')}\n` : '';
}

export function readBlockVersion(source: string): string | null {
  const m = BLOCK_RE.exec(source);
  if (!m) return null;
  return m[1] ?? 'unknown';
}
