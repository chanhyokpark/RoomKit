import type { DoneFn } from '@roomkit/client';
import type { WirePlaySfx } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { resolveSrc } from './resolve';
import { simulate } from './simulate';

interface ActiveSfx {
	audio: HTMLAudioElement | null;
	cancelSimulation: (() => void) | null;
	commandId: string;
	done: DoneFn;
}

/** Fire-and-forget one-shots; overlapping plays on the same player are fine. */
export class SfxChannel {
	private readonly active = new Map<string, Set<ActiveSfx>>();

	play(cmd: WirePlaySfx, done: DoneFn): void {
		let set = this.active.get(cmd.playerId);
		if (!set) this.active.set(cmd.playerId, (set = new Set()));

		if (cmd.url === null || cmd.fileKey === null) {
			stage.addPlaceholder({ id: cmd.id, channel: 'sfx', name: cmd.assetName });
			const entry: ActiveSfx = {
				audio: null,
				cancelSimulation: null,
				commandId: cmd.id,
				done
			};
			set.add(entry);
			entry.cancelSimulation = simulate(cmd.durationMs ?? 0, () => {
				set.delete(entry);
				stage.removePlaceholder(cmd.id);
				done();
			});
			return;
		}

		const audio = new Audio(resolveSrc(cmd.fileKey, cmd.url));
		const entry: ActiveSfx = {
			audio,
			cancelSimulation: null,
			commandId: cmd.id,
			done
		};
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
			entry.cancelSimulation?.();
			stage.removePlaceholder(entry.commandId);
			if (entry.audio) {
				entry.audio.pause();
				entry.audio.removeAttribute('src');
			}
			entry.done();
		}
		this.active.delete(playerId);
	}

	stopAll(): void {
		for (const playerId of [...this.active.keys()]) this.stop(playerId);
	}
}
