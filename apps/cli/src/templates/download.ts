import { ToolError } from '../core/session.js';
import { REPO } from '../version.js';

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_BYTES = 50 * 1024 * 1024;

/** codeload archive URL for a branch, tag, or commit sha. */
export function archiveUrl(ref: string): string {
  const isSha = /^[0-9a-f]{7,40}$/i.test(ref);
  const path = isSha ? ref : ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;
  return `https://codeload.github.com/${REPO}/zip/${path}`;
}

/** Downloads the repository zip (source of truth for templates) at `ref`. */
export async function downloadRepoArchive(ref: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const url = archiveUrl(ref);
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ToolError(`템플릿 다운로드 실패 (${url}): ${err instanceof Error ? err.message : String(err)}`, 'network');
  }
  if (res.status === 404 && !ref.startsWith('refs/') && !/^[0-9a-f]{7,40}$/i.test(ref)) {
    // Maybe a tag rather than a branch.
    return downloadRepoArchive(`refs/tags/${ref}`, fetchImpl);
  }
  if (!res.ok) throw new ToolError(`템플릿 다운로드 실패 (${url}): HTTP ${res.status}`, 'network');
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > MAX_BYTES) throw new ToolError(`저장소 아카이브가 너무 큽니다 (${length} bytes).`, 'network');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw new ToolError(`저장소 아카이브가 너무 큽니다 (${bytes.byteLength} bytes).`, 'network');
  return bytes;
}
