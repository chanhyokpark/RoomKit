/**
 * `roomkit-player://` app links. The Player app registers this URL scheme so
 * a browser page (Studio) or a terminal (`rk dev`) can hand it a test session
 * to open: Player fetches the session, opens one stage window per test device
 * code, and opens its debug window.
 *
 *   roomkit-player://test?server=<origin>&session=<uuid>   open a test session
 *   roomkit-player://launch?server=<origin>                just start / focus Player
 *
 * `server` is the RoomKit server origin (no /api suffix). Player asks before
 * switching to a server that differs from its configured one. `source` names
 * who fired the link (`studio`, `cli`): a Studio launch keeps its own session
 * dashboard, so Player skips its debug window for it.
 *
 * Hand-rolled query handling: this package compiles against the ES lib only
 * (no DOM / node typings), and the format is tiny.
 */
export const PLAYER_URL_SCHEME = 'roomkit-player';

export type PlayerLinkSource = 'studio' | 'cli';

export type PlayerLink =
  | { action: 'test'; server: string | null; sessionId: string; source: PlayerLinkSource | null }
  | { action: 'launch'; server: string | null };

function normalizeServer(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  return trimmed ? trimmed : null;
}

function query(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

/** App link that opens test session `sessionId` in Player. */
export function playerTestLink(
  serverUrl: string,
  sessionId: string,
  options: { source?: PlayerLinkSource } = {},
): string {
  return `${PLAYER_URL_SCHEME}://test?${query({
    server: normalizeServer(serverUrl) ?? serverUrl,
    session: sessionId,
    ...(options.source ? { source: options.source } : {}),
  })}`;
}

/** App link that starts Player pointed at `serverUrl`. */
export function playerLaunchLink(serverUrl: string): string {
  return `${PLAYER_URL_SCHEME}://launch?${query({ server: normalizeServer(serverUrl) ?? serverUrl })}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of search.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const rawKey = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? '' : part.slice(eq + 1);
    try {
      out[decodeURIComponent(rawKey.replace(/\+/g, ' '))] = decodeURIComponent(rawValue.replace(/\+/g, ' '));
    } catch {
      // malformed percent-encoding: skip the pair
    }
  }
  return out;
}

/**
 * Parses an app link; null for anything that is not a well-formed
 * `roomkit-player://` URL. Tolerates the host/path variations different
 * platforms produce (`roomkit-player://test?…`, `roomkit-player://test/?…`,
 * `roomkit-player:///test?…`, `roomkit-player:test?…`).
 */
export function parsePlayerLink(raw: string): PlayerLink | null {
  const match = /^([a-z][a-z0-9+.-]*):\/{0,3}([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(raw.trim());
  if (!match || match[1]!.toLowerCase() !== PLAYER_URL_SCHEME) return null;
  const action = match[2]!.split('/').filter(Boolean)[0]?.toLowerCase() ?? '';
  const params = parseQuery(match[3] ?? '');
  const server = normalizeServer(params['server']);
  if (action === 'test') {
    const sessionId = params['session']?.trim() ?? '';
    if (!UUID_RE.test(sessionId)) return null;
    const rawSource = params['source']?.trim().toLowerCase();
    const source: PlayerLinkSource | null =
      rawSource === 'studio' || rawSource === 'cli' ? rawSource : null;
    return { action: 'test', server, sessionId: sessionId.toLowerCase(), source };
  }
  if (action === 'launch') return { action: 'launch', server };
  return null;
}
