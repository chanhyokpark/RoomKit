import { cache } from '../cache/manager.svelte';

/**
 * Media source for a wire play command: the local cache when the file is
 * already downloaded, else the presigned URL (and a background download so
 * the next playback hits the cache). fileKeys are immutable, so presence in
 * the cache means fresh.
 */
export function resolveSrc(fileKey: string, url: string): string {
	const local = cache.localSrc(fileKey);
	if (local) return local;
	void cache.ensure(fileKey, url);
	return url;
}
