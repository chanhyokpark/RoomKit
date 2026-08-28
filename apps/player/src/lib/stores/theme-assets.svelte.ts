import { AssetSchema, type Asset } from '@roomkit/shared';
import { api } from '../api';
import { vlog } from '../log';

/**
 * The debug window's read-only view of the theme's assets: phases/events for
 * controls and the sequence preview, devices/websites/messages/players/hints
 * for manual commands. Refreshable; rows failing schema parse are dropped.
 */
class ThemeAssetsStore {
	assets = $state<Asset[]>([]);
	loading = $state(false);
	error = $state('');

	readonly phases = $derived(
		this.assets
			.filter((a) => a.kind === 'phase')
			.sort((a, b) => a.data.order - b.data.order || a.name.localeCompare(b.name))
	);
	readonly events = $derived(this.assets.filter((a) => a.kind === 'event'));
	readonly devices = $derived(this.assets.filter((a) => a.kind === 'device'));
	readonly websites = $derived(this.assets.filter((a) => a.kind === 'website'));
	readonly messages = $derived(this.assets.filter((a) => a.kind === 'message'));
	readonly players = $derived(this.assets.filter((a) => a.kind === 'player'));
	readonly hints = $derived(this.assets.filter((a) => a.kind === 'hint'));
	readonly bgms = $derived(this.assets.filter((a) => a.kind === 'bgm'));
	readonly sfxs = $derived(this.assets.filter((a) => a.kind === 'sfx'));
	readonly videos = $derived(this.assets.filter((a) => a.kind === 'video'));
	readonly dialogues = $derived(this.assets.filter((a) => a.kind === 'dialogue'));

	async load(themeId: string): Promise<void> {
		this.loading = true;
		this.error = '';
		try {
			const rows = await api<unknown[]>(`/themes/${themeId}/assets`);
			const parsed: Asset[] = [];
			for (const row of rows) {
				const result = AssetSchema.safeParse(row);
				if (result.success) parsed.push(result.data);
				else vlog('debug', 'asset row dropped (schema mismatch)', row);
			}
			this.assets = parsed;
		} catch (err) {
			this.error = '테마 애셋을 불러오지 못했습니다.';
			vlog('debug', 'theme assets load failed', err);
		} finally {
			this.loading = false;
		}
	}

	name(assetId: string | null | undefined): string {
		if (!assetId) return '(미설정)';
		return this.assets.find((a) => a.id === assetId)?.name ?? '(삭제됨)';
	}

	phaseName(phaseId: string | null): string {
		if (phaseId === null) return '공통';
		return this.name(phaseId);
	}
}

export const themeAssets = new ThemeAssetsStore();
