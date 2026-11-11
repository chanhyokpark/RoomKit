import { getContext, setContext } from 'svelte';
import { toast } from 'svelte-sonner';
import type { Asset, AssetKind, Tag } from '@roomkit/shared';
import { getAsset, listAssets } from '$lib/api/assets';
import { ApiError } from '$lib/api/client';
import { listTags } from '$lib/api/tags';
import { watchThemeAssets, type ThemeAssetChange } from '$lib/api/live';

export type PhaseAsset = Extract<Asset, { kind: 'phase' }>;
export type EventAsset = Extract<Asset, { kind: 'event' }>;

/**
 * All assets of the theme, shared by every editor component via context.
 * Pickers, name resolution, and dangling-reference checks all read from here.
 * The full list is heavy on large themes, so single-asset changes patch it in
 * place: editor mutations call apply()/drop() with their result, and server
 * `theme:assets` broadcasts naming one asset fetch just that asset. refresh()
 * refetches everything (broadcasts without an asset, reconnects, bulk edits).
 */
export class EditorData {
	readonly themeId: string;

	assets = $state<Asset[]>([]);
	tags = $state<Tag[]>([]);
	loading = $state(true);

	#requestId = 0;
	/** Bumped by every in-place patch; a refresh that raced one is retried. */
	#patches = 0;
	#unwatch: () => void;

	// Rebuilt wholesale by $derived and never mutated, so a plain Map is fine.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	byId = $derived(new Map(this.assets.map((asset) => [asset.id, asset])));
	phases = $derived(
		(this.assets.filter((asset) => asset.kind === 'phase') as PhaseAsset[]).toSorted(
			(a, b) => a.data.order - b.data.order || a.name.localeCompare(b.name)
		)
	);
	events = $derived(this.assets.filter((asset) => asset.kind === 'event') as EventAsset[]);

	constructor(themeId: string) {
		this.themeId = themeId;
		void this.refresh();
		this.#unwatch = watchThemeAssets(themeId, (change) => void this.#sync(change));
	}

	dispose(): void {
		this.#unwatch();
	}

	byKind<K extends AssetKind>(kind: K): Extract<Asset, { kind: K }>[] {
		return this.assets.filter((asset) => asset.kind === kind) as Extract<Asset, { kind: K }>[];
	}

	/** Events of one workspace: a phase id, or null for the common workspace. */
	eventsFor(phaseId: string | null): EventAsset[] {
		return this.events.filter((event) => event.data.phaseId === phaseId);
	}

	/** Puts a created/updated asset into the list without refetching it. */
	apply(asset: Asset): void {
		this.#patches++;
		const index = this.assets.findIndex((candidate) => candidate.id === asset.id);
		if (index === -1) {
			this.assets = [...this.assets, asset];
			return;
		}
		// Out-of-order responses must not roll an asset back.
		if (this.assets[index].updatedAt > asset.updatedAt) return;
		this.assets = this.assets.with(index, asset);
	}

	/** Removes a deleted asset from the list without refetching it. */
	drop(assetId: string): void {
		this.#patches++;
		this.assets = this.assets.filter((asset) => asset.id !== assetId);
	}

	async refresh(): Promise<void> {
		const rid = ++this.#requestId;
		try {
			for (;;) {
				const patches = this.#patches;
				const [assets, tags] = await Promise.all([
					listAssets(this.themeId),
					listTags(this.themeId)
				]);
				if (rid !== this.#requestId) return;
				// A patch landed mid-flight: this snapshot may predate it.
				if (patches !== this.#patches) continue;
				this.assets = assets;
				this.tags = tags;
				return;
			}
		} catch {
			if (rid === this.#requestId) toast.error('애셋 목록을 불러오지 못했습니다.');
		} finally {
			if (rid === this.#requestId) this.loading = false;
		}
	}

	async #sync(change: ThemeAssetChange): Promise<void> {
		if (!change) return this.refresh();
		if (change.removed) return this.drop(change.assetId);
		try {
			this.apply(await getAsset(this.themeId, change.assetId));
		} catch (error) {
			// Deleted again before the fetch; anything else falls back to a refetch.
			if (error instanceof ApiError && error.status === 404) this.drop(change.assetId);
			else await this.refresh();
		}
	}
}

const EDITOR_DATA_KEY = Symbol('editor-data');

export function provideEditorData(themeId: string): EditorData {
	return setContext(EDITOR_DATA_KEY, new EditorData(themeId));
}

export function useEditorData(): EditorData {
	return getContext<EditorData>(EDITOR_DATA_KEY);
}
