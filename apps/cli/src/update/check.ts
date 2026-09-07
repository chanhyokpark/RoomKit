import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions } from '@roomkit/shared';
import { ROOMKIT_HOME } from '../core/creds.js';
import { CLI_VERSION, RAW_BASE } from '../version.js';

export const UPDATE_CACHE_PATH = join(ROOMKIT_HOME, 'cli-update.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface UpdateInfo {
  current: string;
  latest: string;
  outdated: boolean;
  checkedAt: string;
  /** True when served from the 24h cache. */
  cached: boolean;
}

interface Cache {
  checkedAt: string;
  latest: string;
}

function readCache(): Cache | null {
  try {
    const raw = JSON.parse(readFileSync(UPDATE_CACHE_PATH, 'utf8')) as Cache;
    return typeof raw.latest === 'string' && typeof raw.checkedAt === 'string' ? raw : null;
  } catch {
    return null;
  }
}

function writeCache(cache: Cache): void {
  try {
    mkdirSync(ROOMKIT_HOME, { recursive: true });
    writeFileSync(UPDATE_CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    // Cache is best-effort.
  }
}

/** Latest CLI version on master: the source of truth is the repository itself. */
export async function fetchLatestVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${RAW_BASE}apps/cli/package.json`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const pkg = (await res.json()) as { version?: unknown };
  if (typeof pkg.version !== 'string') throw new Error('package.json has no version');
  return pkg.version;
}

/**
 * Compares the installed CLI with master. Uses a 24h cache unless forced;
 * resolves null on any network failure (never blocks a command).
 */
export async function checkForUpdate(opts: { force?: boolean; fetchImpl?: typeof fetch; now?: Date } = {}): Promise<UpdateInfo | null> {
  const now = opts.now ?? new Date();
  const cache = opts.force ? null : readCache();
  if (cache && now.getTime() - new Date(cache.checkedAt).getTime() < CACHE_TTL_MS) {
    return toInfo(cache.latest, cache.checkedAt, true);
  }
  try {
    const latest = await fetchLatestVersion(opts.fetchImpl);
    const checkedAt = now.toISOString();
    writeCache({ checkedAt, latest });
    return toInfo(latest, checkedAt, false);
  } catch {
    return null;
  }
}

function toInfo(latest: string, checkedAt: string, cached: boolean): UpdateInfo {
  const isDev = CLI_VERSION.endsWith('-dev');
  return { current: CLI_VERSION, latest, outdated: !isDev && compareVersions(CLI_VERSION, latest) < 0, checkedAt, cached };
}
