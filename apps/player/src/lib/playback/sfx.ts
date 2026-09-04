import type { DoneFn } from '@roomkit/client';
import type { WirePlaySfx } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { createAudio } from './resolve';
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
		const playerSet = set;
		const chip = (entry: ActiveSfx) =>
			stage.addPlaceholder({
				id: cmd.id,
				channel: 'sfx',
				name: cmd.assetName,
				// Only this one-shot; other SFX overlapping on the player keep going.
				stop: () => {
					if (playerSet.has(entry)) this.stopEntry(entry, playerSet);
				}
			});

		if (cmd.url === null || cmd.fileKey === null) {
			const entry: ActiveSfx = {
				audio: null,
				cancelSimulation: null,
				commandId: cmd.id,
				done
			};
			set.add(entry);
			chip(entry);
			entry.cancelSimulation = simulate(cmd.durationMs ?? 0, () => {
				set.delete(entry);
				stage.removePlaceholder(cmd.id);
				done();
			});
			return;
		}

		const audio = createAudio(cmd.fileKey, cmd.url);
		const entry: ActiveSfx = {
			audio,
			cancelSimulation: null,
			commandId: cmd.id,
			done
		};
		set.add(entry);
		chip(entry);
		const settle = (status?: 'done' | 'failed') => {
			set.delete(entry);
			stage.removePlaceholder(cmd.id);
			done(status);
		};
		audio.addEventListener('ended', () => settle());
		audio.addEventListener('error', () => settle('failed'));
		void audio.play().catch(() => settle('failed'));
	}

	stop(playerId: string): void {
		const set = this.active.get(playerId);
		if (!set) return;
		for (const entry of [...set]) this.stopEntry(entry, set);
		this.active.delete(playerId);
	}

	private stopEntry(entry: ActiveSfx, set: Set<ActiveSfx>): void {
		set.delete(entry);
		entry.cancelSimulation?.();
		stage.removePlaceholder(entry.commandId);
		if (entry.audio) {
			entry.audio.pause();
			entry.audio.removeAttribute('src');
		}
		entry.done();
	}

	stopAll(): void {
		for (const playerId of [...this.active.keys()]) this.stop(playerId);
	}
}
