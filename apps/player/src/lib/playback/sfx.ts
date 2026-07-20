import type { DoneFn } from '@roomkit/client';
import type { WirePlaySfx } from '@roomkit/shared';
import { resolveSrc } from './resolve';

/** Fire-and-forget one-shots; overlapping plays on the same player are fine. */
export class SfxChannel {
	private readonly active = new Map<string, Set<{ audio: HTMLAudioElement; done: DoneFn }>>();

	play(cmd: WirePlaySfx, done: DoneFn): void {
		const audio = new Audio(resolveSrc(cmd.fileKey, cmd.url));
		let set = this.active.get(cmd.playerId);
		if (!set) this.active.set(cmd.playerId, (set = new Set()));
		const entry = { audio, done };
		set.add(entry);
		const settle = (status?: 'done' | 'failed') => {
			set.delete(entry);
			done(status);
		};
		audio.addEventListener('ended', () => settle());
		audio.addEventListener('error', () => settle('failed'));
		void audio.play().catch(() => settle('failed'));
	}

	stop(playerId: string): void {
		for (const entry of this.active.get(playerId) ?? []) {
			entry.audio.pause();
			entry.audio.removeAttribute('src');
			entry.done();
		}
		this.active.delete(playerId);
	}

	stopAll(): void {
		for (const playerId of [...this.active.keys()]) this.stop(playerId);
	}
}
