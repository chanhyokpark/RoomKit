import type { Theme } from '@roomkit/shared';
import { listThemes } from '$lib/api/themes';

class ThemesStore {
	themes = $state<Theme[]>([]);
	loaded = $state(false);

	async refresh(): Promise<void> {
		this.themes = await listThemes();
		this.loaded = true;
	}

	find(id: string | undefined): Theme | undefined {
		return id ? this.themes.find((theme) => theme.id === id) : undefined;
	}
}

export const themesStore = new ThemesStore();
