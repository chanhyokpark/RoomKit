export interface Subtitle {
	html: string;
	css: string;
}

export interface Skippable {
	/** Wire command id of the running playback. */
	id: string;
	kind: 'dialogue' | 'video';
	skip: () => void;
}

/**
 * What the stage window currently shows. Playback channels write here; the
 * DOM (Stage.svelte and friends) only reads.
 */
class StageStore {
	videoSrc = $state<string | null>(null);
	subtitle = $state<Subtitle | null>(null);
	iframeUrl = $state<string | null>(null);
	/** Running skippable playbacks — the test overlay renders one button each. */
	skippables = $state<Skippable[]>([]);

	addSkippable(entry: Skippable): void {
		this.skippables = [...this.skippables.filter((s) => s.id !== entry.id), entry];
	}

	removeSkippable(id: string): void {
		this.skippables = this.skippables.filter((s) => s.id !== id);
	}

	/** Device reset: back to the idle black screen. */
	clear(): void {
		this.videoSrc = null;
		this.subtitle = null;
		this.iframeUrl = null;
		this.skippables = [];
	}
}

export const stage = new StageStore();
