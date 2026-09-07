import { ToolError } from './session.js';

/** The roomkit Agent Skill on the repository master branch (SKILL.md + references/). */
export const RAW_DOCS_BASE =
  'https://raw.githubusercontent.com/chanhyokpark/RoomKit/refs/heads/master/skills/roomkit/';

const DOC_REQUEST_TIMEOUT_MS = 10_000;

/** Normalize a path copied from SKILL.md without allowing it to escape the skill directory. */
export function normalizeDocname(value: string): string {
  let docname = value.trim();
  while (docname.startsWith('./')) docname = docname.slice(2);

  if (!docname) throw new ToolError('docname must not be empty. Run `rk docs list` for valid paths.', 'usage');
  if (docname.startsWith('/') || docname.includes('\\')) {
    throw new ToolError('docname must be a relative POSIX path (for example references/helper.md).', 'usage');
  }
  if (docname.includes('?') || docname.includes('#')) {
    throw new ToolError('docname must not contain a query string or fragment.', 'usage');
  }

  const segments = docname.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ToolError('docname contains an invalid path segment. Run `rk docs list` for valid paths.', 'usage');
  }
  if (!docname.endsWith('.md')) {
    throw new ToolError('docname must point to a Markdown (.md) document.', 'usage');
  }

  return segments.map(encodeURIComponent).join('/');
}

/** Read the canonical documentation from the repository's master branch. */
export async function readRemoteDoc(docname: string): Promise<string> {
  const normalized = normalizeDocname(docname);
  const url = `${RAW_DOCS_BASE}${normalized}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'text/markdown,text/plain;q=0.9,*/*;q=0.1' },
      signal: AbortSignal.timeout(DOC_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ToolError(`Timed out after ${DOC_REQUEST_TIMEOUT_MS}ms while reading ${docname}.`, 'network');
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ToolError(`Could not read ${docname} from the RoomKit documentation: ${detail}`, 'network');
  }

  if (!response.ok) {
    throw new ToolError(
      `Could not read ${docname} from the RoomKit documentation: HTTP ${response.status} ${response.statusText}.`,
      'network',
    );
  }

  return response.text();
}
