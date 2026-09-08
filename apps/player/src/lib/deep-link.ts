import { parsePlayerLink, type PlayerLink } from '@roomkit/shared';
import { vlog } from './log';
import { isTauri } from './tauri';

/**
 * `roomkit-player://` app links (see @roomkit/shared player-link). Delivered
 * two ways: `getCurrent()` for the URL the app was launched with (cold start —
 * the JS listener does not exist yet when the OS hands the URL over) and the
 * `deep-link://new-url` event while running. A cold start on macOS can surface
 * the same URL through both, so recent raw URLs are de-duplicated.
 *
 * In the browser dev harness (`pnpm dev:web`) the page's own `?link=` query
 * stands in for the OS, e.g. `/?link=roomkit-player%3A%2F%2Ftest%3F…`.
 */
export async function listenForAppLinks(
	handler: (link: PlayerLink, raw: string) => void
): Promise<() => void> {
	const recent = new Map<string, number>();
	const deliver = (urls: string[] | null | undefined): void => {
		for (const raw of urls ?? []) {
			const now = Date.now();
			const last = recent.get(raw);
			if (last !== undefined && now - last < 3000) continue;
			recent.set(raw, now);
			const link = parsePlayerLink(raw);
			if (!link) {
				vlog('deep-link', 'ignored url', raw);
				continue;
			}
			vlog('deep-link', 'received', link);
			handler(link, raw);
		}
	};

	if (!isTauri()) {
		const fake = new URLSearchParams(window.location.search).get('link');
		if (fake) deliver([fake]);
		return () => {};
	}
	const plugin = await import('@tauri-apps/plugin-deep-link');
	const unlisten = await plugin.onOpenUrl(deliver);
	try {
		deliver(await plugin.getCurrent());
	} catch (err) {
		// Windows/Linux without a registered scheme, or an old runtime: no launch URL.
		vlog('deep-link', 'getCurrent failed', err);
	}
	return unlisten;
}
