/**
 * Component version reporting. The player app, `@roomkit/client`, and
 * `@roomkit/helper` report their own versions in their handshakes; the server
 * relays them to studio, which warns when a detected version is below the
 * expected minimum. Components predating version reporting show up as `null`
 * (the server/player detected the component but it sent no version) and are
 * treated as outdated; an absent field means nothing was detected (or the
 * server predates the feature) and is never warned about.
 */

/**
 * Minimum component versions studio expects — bump alongside releases that
 * operators should not run older components against. Studio deployments can
 * override these with the PUBLIC_EXPECTED_{PLAYER,CLIENT,HELPER}_VERSION
 * environment variables.
 */
export const EXPECTED_VERSIONS = {
  /** Player app (apps/player package.json / tauri.conf.json). */
  player: "0.9.1",
  /** @roomkit/client (packages/client). */
  client: "0.3.0",
  /** @roomkit/helper (packages/helper). */
  helper: "0.4.0",
} as const;

export type VersionedComponent = keyof typeof EXPECTED_VERSIONS;

/**
 * Dotted-numeric version compare: negative when a < b, 0 when equal,
 * positive when a > b. Non-numeric segment tails are ignored ('1-beta' → 1);
 * missing segments count as 0 ('1.2' == '1.2.0').
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * True when a detected version is below the minimum. `null` (component
 * detected, but it predates version reporting) counts as below.
 */
export function isVersionBelow(
  version: string | null,
  minimum: string,
): boolean {
  return version === null || compareVersions(version, minimum) < 0;
}
