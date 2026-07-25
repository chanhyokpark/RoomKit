import { cache } from '../cache/manager.svelte';

/**
 * Media source for a wire play command: the local cache when the file is
 * already downloaded, else the presigned URL (and a background download so
 * the next playback hits the cache). fileKeys are immutable, so presence in
 * the cache means fresh.
 *
 * Cached files are served via the loopback media server (Range support,
 * proven for delegated video) — the tauri `asset://` protocol 404s cached
 * media on macOS despite the file existing, so it is only the fallback for
 * the rare case where the media server failed to start.
 */
export function resolveSrc(fileKey: string, url: string): string {
	const local = cache.httpSrc(fileKey) ?? cache.localSrc(fileKey);
	if (local) return local;
	void cache.ensure(fileKey, url);
	return url;
}

/**
 * Audio element on the resolved source with a one-shot fallback: when the
 * cached copy errors (pruned by another window, corrupt, media server down),
 * the presigned URL is retried once — transparently, before the caller's own
 * 'error' listeners run (they are attached after this one, and the swap stops
 * immediate propagation). A second failure reaches the caller as usual.
 */
export function createAudio(fileKey: string, url: string): HTMLAudioElement {
	const src = resolveSrc(fileKey, url);
	const audio = new Audio(src);
	if (src === url) return audio;

	// The cached load can fail through two signals — the element's 'error'
	// event and the play() promise rejection — usually both. Whichever comes
	// first performs the swap; the other is swallowed so the caller's own
	// error handling only sees a failure of the presigned retry.
	let fellBack = false;
	const fallBack = (): boolean => {
		if (fellBack) return false;
		fellBack = true;
		cache.invalidate(fileKey);
		console.warn('[player] cached media failed, falling back to presigned url', fileKey);
		audio.src = url;
		return true;
	};
	const nativePlay = audio.play.bind(audio);
	const onError = (event: Event) => {
		audio.removeEventListener('error', onError);
		event.stopImmediatePropagation();
		if (fallBack()) {
			void nativePlay().catch(() => audio.dispatchEvent(new Event('error')));
		}
	};
	audio.addEventListener('error', onError);
	audio.play = () =>
		nativePlay().catch((err: unknown) => {
			if (fallBack()) {
				audio.removeEventListener('error', onError);
				return nativePlay();
			}
			if (fellBack) return; // the error-event path is already retrying
			throw err;
		});
	return audio;
}
