/**
 * Sent in the hello envelope so the player (and through it, studio) can warn
 * about outdated helper bundles embedded in websites. Kept as a source
 * literal (not a build-time define) so the iife embed and source-aliased
 * consumers agree. Keep in sync with package.json — asserted in helper.test.ts.
 */
export const HELPER_VERSION = '0.3.0';
