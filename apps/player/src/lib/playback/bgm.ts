import type { DoneFn } from '@roomkit/client';
import type { WirePlayBgm } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { resolveSrc } from './resolve';
import { simulate } from './simulate';

interface ActiveBgm {
	audio: HTMLAudioElement | null;
	cancelSimulation: (() => void) | null;
	cancelFade: (() => void) | null;
	/** From the play wire (the BGM asset's setting); applied on stop/replace. */
	fadeOutMs: number;
	commandId: string;
	done: DoneFn;
}

const FADE_TICK_MS = 50;

/** Linearly ramps audio.volume to `target` over `durationMs`; returns a cancel fn. */
function fadeVolume(
	audio: HTMLAudioElement,
	target: number,
	durationMs: number,
	onDone?: () => void
): () => void {
	const start = audio.volume;
	const startAt = performance.now();
	const timer = setInterval(() => {
		const progress = Math.min(1, (performance.now() - startAt) / durationMs);
		audio.volume = start + (target - start) * progress;
		if (progress >= 1) {
			clearInterval(timer);
			onDone?.();
		}
	}, FADE_TICK_MS);
	return () => clearInterval(timer);
}

/**
 * One BGM per player (a device can serve several Player assets). Looping BGM
 * acks on playback start, non-looping on end — the wire contract. done() is
 * idempotent, so every termination path may call it.
 *
 * Placeholder BGM (url null) shows an overlay chip and simulates for
 * durationMs; looping placeholders ack immediately and stay until stopped.
 *
 * Fades come from the BGM asset via the play wire: fadeInMs ramps from 0 on
 * play; fadeOutMs is stored and applied when the track is stopped or replaced
 * (replacement = crossfade — the old track ramps down detached while the new
 * one starts). A stop with fade acks immediately (apply semantics) and
 * releases the audio element after the ramp.
 */
export class BgmChannel {
	private readonly active = new Map<string, ActiveBgm>();
	/** Detached fade-outs still ramping; killed instantly by stopAll (reset). */
	private readonly fadingOut = new Set<{
		audio: HTMLAudioElement;
		cancel: () => void;
	}>();

	play(cmd: WirePlayBgm, done: DoneFn): void {
		this.stop(cmd.playerId); // replace: ack the old one out (crossfade)

		if (cmd.url === null || cmd.fileKey === null) {
			stage.addPlaceholder({ id: cmd.id, channel: 'bgm', name: cmd.assetName });
			const entry: ActiveBgm = {
				audio: null,
				cancelSimulation: null,
				cancelFade: null,
				fadeOutMs: cmd.fadeOutMs,
				commandId: cmd.id,
				done
			};
			this.active.set(cmd.playerId, entry);
			if (cmd.loop) {
				done();
			} else {
				entry.cancelSimulation = simulate(cmd.durationMs ?? 0, () => {
					this.active.delete(cmd.playerId);
					stage.removePlaceholder(cmd.id);
					done();
				});
			}
			return;
		}

		const audio = new Audio(resolveSrc(cmd.fileKey, cmd.url));
		audio.loop = cmd.loop;
		const entry: ActiveBgm = {
			audio,
			cancelSimulation: null,
			cancelFade: null,
			fadeOutMs: cmd.fadeOutMs,
			commandId: cmd.id,
			done
		};
		this.active.set(cmd.playerId, entry);
		if (cmd.fadeInMs > 0) {
			audio.volume = 0;
			entry.cancelFade = fadeVolume(audio, 1, cmd.fadeInMs, () => {
				entry.cancelFade = null;
			});
		}
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

	stop(playerId: string, opts: { instant?: boolean } = {}): void {
		const entry = this.active.get(playerId);
		if (!entry) return;
		this.active.delete(playerId);
		entry.cancelSimulation?.();
		entry.cancelFade?.();
		stage.removePlaceholder(entry.commandId);
		const { audio } = entry;
		if (audio) {
			const fadeOutMs = opts.instant ? 0 : entry.fadeOutMs;
			if (fadeOutMs > 0) {
				const detached = {
					audio,
					cancel: () => {}
				};
				detached.cancel = fadeVolume(audio, 0, fadeOutMs, () => {
					this.fadingOut.delete(detached);
					audio.pause();
					audio.removeAttribute('src');
				});
				this.fadingOut.add(detached);
			} else {
				audio.pause();
				audio.removeAttribute('src');
			}
		}
		entry.done();
	}

	/** The stop-all wire (playerId null): each track fades per its own asset. */
	stopAllPlayers(): void {
		for (const playerId of [...this.active.keys()]) this.stop(playerId);
	}

	/** Device reset / session end: instant silence, including mid-fade tracks. */
	stopAll(): void {
		for (const playerId of [...this.active.keys()])
			this.stop(playerId, { instant: true });
		for (const detached of [...this.fadingOut]) {
			detached.cancel();
			detached.audio.pause();
			detached.audio.removeAttribute('src');
		}
		this.fadingOut.clear();
	}
}
