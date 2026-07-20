import type { DoneFn } from '@roomkit/client';
import type { WirePlayBgm } from '@roomkit/shared';
import { resolveSrc } from './resolve';

/**
 * One BGM per player (a device can serve several Player assets). Looping BGM
 * acks on playback start, non-looping on end — the wire contract. done() is
 * idempotent, so every termination path may call it.
 */
export class BgmChannel {
	private readonly active = new Map<string, { audio: HTMLAudioElement; done: DoneFn }>();

	play(cmd: WirePlayBgm, done: DoneFn): void {
		this.stop(cmd.playerId); // replace: ack the old one out
		const audio = new Audio(resolveSrc(cmd.fileKey, cmd.url));
		audio.loop = cmd.loop;
		this.active.set(cmd.playerId, { audio, done });
		if (cmd.loop) {
			audio.addEventListener('playing', () => done(), { once: true });
		} else {
			audio.addEventListener('ended', () => {
				this.active.delete(cmd.playerId);
				done();
			});
		}
		audio.addEventListener('error', () => {
			this.active.delete(cmd.playerId);
			done('failed');
		});
		void audio.play().catch(() => done('failed'));
	}

	stop(playerId: string): void {
		const entry = this.active.get(playerId);
		if (!entry) return;
		this.active.delete(playerId);
		entry.audio.pause();
		entry.audio.removeAttribute('src');
		entry.done();
	}

	stopAll(): void {
		for (const playerId of [...this.active.keys()]) this.stop(playerId);
	}
}
