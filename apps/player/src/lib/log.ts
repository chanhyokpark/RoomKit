/**
 * Verbose devtools logging for the player's own layers (the device socket
 * logs via the client's `debug` option instead). On in dev builds — the same
 * builds whose webviews have devtools.
 */
export const verboseLogs = import.meta.env.DEV;

export function vlog(scope: string, ...args: unknown[]): void {
	if (verboseLogs) console.log(`[player:${scope}]`, ...args);
}
