import { toast } from 'svelte-sonner';
import { getFileUrl } from '$lib/api/uploads';

/** One-at-a-time audio playback for asset list previews. */
class PlaybackStore {
	/** fileKey currently playing (or being loaded). */
	playingKey = $state<string | null>(null);
	private audio: HTMLAudioElement | null = null;

	async toggle(fileKey: string): Promise<void> {
		if (this.playingKey === fileKey) {
			this.stop();
			return;
		}
		this.stop();
		this.playingKey = fileKey;
		try {
			const url = await getFileUrl(fileKey);
			if (this.playingKey !== fileKey) return;
			const audio = new Audio(url);
			this.audio = audio;
			audio.addEventListener('ended', () => {
				if (this.playingKey === fileKey) this.stop();
			});
			await audio.play();
		} catch {
			if (this.playingKey === fileKey) {
				this.stop();
				toast.error('재생에 실패했습니다.');
			}
		}
	}

	stop(): void {
		this.audio?.pause();
		this.audio = null;
		this.playingKey = null;
	}
}

export const playback = new PlaybackStore();
