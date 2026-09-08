import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

/**
 * Opens a URL (http or a custom scheme such as `roomkit-player://`) with the
 * OS default handler. Resolves false when the opener is missing or reports
 * failure — on macOS `open` exits non-zero when no app owns the scheme, which
 * is the "Player is not installed" signal callers want to explain.
 */
export function openExternal(url: string): Promise<boolean> {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url.replace(/&/g, '^&')]]
        : ['xdg-open', [url]];
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
      child.on('error', () => done(false));
      child.on('close', (code) => done(code === 0));
      child.unref();
    } catch {
      done(false);
    }
    // xdg-open can block while the handler runs; treat "still running" as success.
    setTimeout(() => done(true), 5000).unref();
  });
}

/** First non-internal IPv4 address (for pointing another machine at a local dev server). */
export function lanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

/** True when any HTTP response comes back from `url` within `timeoutMs` (a 404 still means "up"). */
export async function isReachable(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return true;
  } catch {
    return false;
  }
}
