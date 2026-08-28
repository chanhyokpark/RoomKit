import { DeviceDataSchema, WebsiteDataSchema, type SessionResponse } from '@roomkit/shared';
import { api, ApiError } from '../api';
import { vlog } from '../log';
import { openDebugWindow } from '../windows';
import { config } from './config.svelte';

export interface ThemeOption {
	id: string;
	name: string;
}

export interface DeviceOption {
	id: string;
	name: string;
	displayName: string;
	/** Website the device navigates to on session start (asset property). */
	startWebsiteId: string | null;
}

export interface WebsiteOption {
	id: string;
	name: string;
	/** Resolved default URL, shown as the override placeholder. */
	defaultUrl: string;
}

interface AssetRow {
	id: string;
	kind: string;
	name: string;
	data: unknown;
}

/**
 * Test-tab state: the theme list (admin REST), the selected theme's devices/
 * websites, and the launch flow. Selections live in config.testConfigs and
 * persist per theme.
 */
class TestSetupStore {
	themes = $state<ThemeOption[]>([]);
	devices = $state<DeviceOption[]>([]);
	websites = $state<WebsiteOption[]>([]);
	loading = $state(false);
	starting = $state(false);
	error = $state('');
	/** Session id of the last test started from this launcher. */
	lastSessionId = $state<string | null>(null);

	async loadThemes(): Promise<void> {
		this.error = '';
		try {
			const rows = await api<{ id: string; name: string }[]>('/themes');
			this.themes = rows.map((t) => ({ id: t.id, name: t.name }));
			// A stored selection may point at a deleted theme — fall back cleanly.
			if (config.selectedThemeId && !this.themes.some((t) => t.id === config.selectedThemeId)) {
				config.selectedThemeId = '';
			}
			if (config.selectedThemeId) await this.loadAssets(config.selectedThemeId);
		} catch (err) {
			this.fail(err, '테마 목록을 불러오지 못했습니다.');
		}
	}

	async selectTheme(themeId: string): Promise<void> {
		config.selectedThemeId = themeId;
		void config.save();
		this.devices = [];
		this.websites = [];
		if (themeId) await this.loadAssets(themeId);
	}

	private async loadAssets(themeId: string): Promise<void> {
		this.loading = true;
		this.error = '';
		try {
			const rows = await api<AssetRow[]>(`/themes/${themeId}/assets`);
			const serverUrl = config.serverUrl.trim().replace(/\/$/, '');
			this.devices = rows
				.filter((r) => r.kind === 'device')
				.map((r) => {
					const data = DeviceDataSchema.safeParse(r.data);
					return {
						id: r.id,
						name: r.name,
						displayName: data.success ? data.data.displayName : r.name,
						startWebsiteId: data.success ? (data.data.startWebsite?.websiteId ?? null) : null
					};
				});
			this.websites = rows
				.filter((r) => r.kind === 'website')
				.map((r) => {
					const data = WebsiteDataSchema.safeParse(r.data);
					const defaultUrl = !data.success
						? ''
						: data.data.mode === 'hosted'
							? `${serverUrl}/api/sites/${r.id}/`
							: data.data.url;
					return { id: r.id, name: r.name, defaultUrl };
				});
			this.pruneSelections(themeId);
			this.syncAutoOverrides(themeId);
		} catch (err) {
			this.fail(err, '테마 애셋을 불러오지 못했습니다.');
		} finally {
			this.loading = false;
		}
	}

	/** Drop selections referencing devices/websites deleted since last time. */
	private pruneSelections(themeId: string): void {
		const tc = config.testConfigFor(themeId);
		const deviceIds = new Set(this.devices.map((d) => d.id));
		const websiteIds = new Set(this.websites.map((w) => w.id));
		tc.deviceIds = tc.deviceIds.filter((id) => deviceIds.has(id));
		tc.overrides = tc.overrides.filter((o) => o.websiteId === '' || websiteIds.has(o.websiteId));
	}

	/**
	 * A selected device with a starting webpage gets an override row for that
	 * website automatically (URL left empty = no substitution until filled).
	 */
	syncAutoOverrides(themeId: string): void {
		const tc = config.testConfigFor(themeId);
		for (const deviceId of tc.deviceIds) {
			const websiteId = this.devices.find((d) => d.id === deviceId)?.startWebsiteId;
			if (!websiteId) continue;
			if (!tc.overrides.some((o) => o.websiteId === websiteId)) {
				tc.overrides.push({ websiteId, url: '' });
			}
		}
	}

	/** Create the test session; windows open via test:start, plus the debug window. */
	async start(): Promise<void> {
		const themeId = config.selectedThemeId;
		const tc = config.testConfigFor(themeId);
		if (!themeId || tc.deviceIds.length === 0) return;
		this.starting = true;
		this.error = '';
		try {
			const session = await api<SessionResponse>('/sessions', {
				method: 'POST',
				body: {
					themeId,
					mode: 'test',
					playerId: config.playerId,
					deviceIds: tc.deviceIds,
					urlOverrides: tc.overrides.filter((o) => o.websiteId !== '' && o.url.trim() !== '')
				}
			});
			vlog('launcher', 'test session created', session.id);
			this.lastSessionId = session.id;
			await openDebugWindow(session.id, themeId);
		} catch (err) {
			this.fail(err, '테스트 세션을 시작하지 못했습니다.');
		} finally {
			this.starting = false;
		}
	}

	private fail(err: unknown, fallback: string): void {
		this.error = err instanceof ApiError ? err.message : fallback;
		vlog('launcher', 'test setup error', err);
	}
}

export const testSetup = new TestSetupStore();
