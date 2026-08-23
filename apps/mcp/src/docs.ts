import { ToolError } from './session.js';

export const RAW_DOCS_BASE =
  'https://raw.githubusercontent.com/chanhyokpark/RoomKit/refs/heads/master/docs/';

const DOC_REQUEST_TIMEOUT_MS = 10_000;

/** Normalize a path copied from TOC_AI.md without allowing it to escape docs/. */
export function normalizeDocname(value: string): string {
  let docname = value.trim();
  while (docname.startsWith('./')) docname = docname.slice(2);

  if (!docname) throw new ToolError('docname must not be empty. Call docs_list for valid paths.');
  if (docname.startsWith('/') || docname.includes('\\')) {
    throw new ToolError('docname must be a relative POSIX path from docs/ (for example ai/helper.md).');
  }
  if (docname.includes('?') || docname.includes('#')) {
    throw new ToolError('docname must not contain a query string or fragment.');
  }

  const segments = docname.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ToolError('docname contains an invalid path segment. Call docs_list for valid paths.');
  }
  if (!docname.endsWith('.md')) {
    throw new ToolError('docname must point to a Markdown (.md) document.');
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
      throw new ToolError(`Timed out after ${DOC_REQUEST_TIMEOUT_MS}ms while reading ${docname}.`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ToolError(`Could not read ${docname} from the RoomKit documentation: ${detail}`);
  }

  if (!response.ok) {
    throw new ToolError(
      `Could not read ${docname} from the RoomKit documentation: HTTP ${response.status} ${response.statusText}.`,
    );
  }

  return response.text();
}
