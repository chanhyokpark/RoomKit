import type { RoomKitClient } from '@roomkit/client';
import { isTauri } from '../tauri';

type SyncState = 'idle' | 'syncing' | 'ready' | 'error';

const DOWNLOAD_CONCURRENCY = 2;

/**
 * Local media cache, keyed by immutable fileKey (presence = fresh; no
 * hashing). Downloads run in Rust (streaming, atomic rename); files are
 * served to the webview through the asset protocol. Everything degrades
 * gracefully: in the browser dev harness or on any error, playback simply
 * streams the presigned URLs that wire commands carry.
 */
class CacheManager {
	state = $state<SyncState>('idle');
	/** Files fetched / total missing during the current sync. */
	progress = $state<{ done: number; total: number } | null>(null);

	private cached = new Set<string>();
	private root: string | null = null;
	private downloading = new Map<string, Promise<boolean>>();
	private syncQueued = false;
	private syncRunning = false;

	/** Local asset-protocol URL when cached, else null. */
	localSrc(fileKey: string): string | null {
		if (!this.root || !this.cached.has(fileKey)) return null;
		// convertFileSrc is imported lazily in init(); root is only set in tauri.
		return this.convert!(`${this.root}/${fileKey}`);
	}

	/**
	 * Loopback media-server URL when cached, else null. Unlike localSrc, this
	 * URL is reachable from cross-origin helper iframes (delegated video).
	 */
	httpSrc(fileKey: string): string | null {
		if (this.mediaPort === null || !this.cached.has(fileKey)) return null;
		const path = fileKey.split('/').map(encodeURIComponent).join('/');
		return `http://127.0.0.1:${this.mediaPort}/${path}`;
	}

	private convert: ((path: string) => string) | null = null;
	private mediaPort: number | null = null;

	async init(): Promise<void> {
		if (!isTauri()) return;
		const [{ invoke, convertFileSrc }] = await Promise.all([import('@tauri-apps/api/core')]);
		this.convert = convertFileSrc;
		this.root = await invoke<string>('cache_root');
		this.mediaPort = await invoke<number | null>('media_server_port').catch(() => null);
		for (const key of await invoke<string[]>('cache_list')) this.cached.add(key);
	}

	/**
	 * Fetch the device manifest and reconcile: download missing files, prune
	 * unreferenced ones. Serialized — a sync requested while one runs is
	 * coalesced into one follow-up pass (welcome fires on every reconnect).
	 */
	async sync(client: RoomKitClient): Promise<void> {
		if (!isTauri()) return;
		if (this.syncRunning) {
			this.syncQueued = true;
			return;
		}
		this.syncRunning = true;
		try {
			do {
				this.syncQueued = false;
				await this.syncOnce(client);
			} while (this.syncQueued);
		} finally {
			this.syncRunning = false;
		}
	}

	/** Background single-file download (cache miss during playback). */
	async ensure(fileKey: string, url: string): Promise<void> {
		if (!isTauri() || !this.root || this.cached.has(fileKey)) return;
		await this.download(fileKey, url);
	}

	private async syncOnce(client: RoomKitClient): Promise<void> {
		this.state = 'syncing';
		try {
			const manifest = await client.fetchAssetManifest();
			const wanted = new Map(manifest.entries.map((e) => [e.fileKey, e.url]));
			const missing = [...wanted].filter(([key]) => !this.cached.has(key));
			this.progress = { done: 0, total: missing.length };

			const queue = [...missing];
			const workers = Array.from(
				{ length: Math.min(DOWNLOAD_CONCURRENCY, queue.length) },
				async () => {
					for (;;) {
						const next = queue.shift();
						if (!next) return;
						await this.download(next[0], next[1]);
						if (this.progress) this.progress.done += 1;
					}
				}
			);
			await Promise.all(workers);

			const { invoke } = await import('@tauri-apps/api/core');
			await invoke('cache_prune', { keep: [...wanted.keys()] });
			for (const key of [...this.cached]) {
				if (!wanted.has(key)) this.cached.delete(key);
			}
			this.state = 'ready';
		} catch (err) {
			console.warn('[player] cache sync failed; streaming from URLs', err);
			this.state = 'error';
		} finally {
			this.progress = null;
		}
	}

	private download(fileKey: string, url: string): Promise<boolean> {
		const running = this.downloading.get(fileKey);
		if (running) return running;
		const task = (async () => {
			try {
				const { invoke } = await import('@tauri-apps/api/core');
				await invoke('cache_download', { fileKey, url });
				this.cached.add(fileKey);
				return true;
			} catch (err) {
				console.warn(`[player] download failed for ${fileKey}`, err);
				return false;
			} finally {
				this.downloading.delete(fileKey);
			}
		})();
		this.downloading.set(fileKey, task);
		return task;
	}
}

export const cache = new CacheManager();
