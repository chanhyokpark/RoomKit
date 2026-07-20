import { getContext, setContext } from 'svelte';
import { toast } from 'svelte-sonner';
import type { Asset, AssetKind, Tag } from '@roomkit/shared';
import { listAssets } from '$lib/api/assets';
import { listTags } from '$lib/api/tags';

export type PhaseAsset = Extract<Asset, { kind: 'phase' }>;
export type EventAsset = Extract<Asset, { kind: 'event' }>;

/**
 * All assets of the theme, shared by every editor component via context.
 * Pickers, name resolution, and dangling-reference checks all read from here;
 * every mutation performed in the editor calls refresh() afterwards.
 */
export class EditorData {
	readonly themeId: string;

	assets = $state<Asset[]>([]);
	tags = $state<Tag[]>([]);
	loading = $state(true);

	#requestId = 0;

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
	}

	byKind<K extends AssetKind>(kind: K): Extract<Asset, { kind: K }>[] {
		return this.assets.filter((asset) => asset.kind === kind) as Extract<Asset, { kind: K }>[];
	}

	/** Events of one workspace: a phase id, or null for the common workspace. */
	eventsFor(phaseId: string | null): EventAsset[] {
		return this.events.filter((event) => event.data.phaseId === phaseId);
	}

	async refresh(): Promise<void> {
		const rid = ++this.#requestId;
		try {
			const [assets, tags] = await Promise.all([listAssets(this.themeId), listTags(this.themeId)]);
			if (rid !== this.#requestId) return;
			this.assets = assets;
			this.tags = tags;
		} catch {
			if (rid === this.#requestId) toast.error('애셋 목록을 불러오지 못했습니다.');
		} finally {
			if (rid === this.#requestId) this.loading = false;
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
