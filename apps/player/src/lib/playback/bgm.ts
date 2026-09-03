import type { DoneFn } from '@roomkit/client';
import type { WirePlayBgm } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { createAudio } from './resolve';
import { simulate } from './simulate';

interface ActiveBgm {
	audio: HTMLAudioElement | null;
	/** Fade-in/out position (0..1); audible = fade × volume × duck. */
	baseVolume: number;
	/** Explicit volume factor (0..1) set by adjustBgmVolume. */
	volumeFactor: number;
	/** Duck factor (0..1) from the engine's duck coordinator; 1 = no duck. */
	duckFactor: number;
	cancelSimulation: (() => void) | null;
	cancelFade: (() => void) | null;
	cancelDuck: (() => void) | null;
	/** From the play wire (the BGM asset's setting); applied on stop/replace. */
	fadeOutMs: number;
	commandId: string;
	done: DoneFn;
}

const FADE_TICK_MS = 50;
export const DUCK_RAMP_MS = 250;

/** Linearly ramps a value to `target` over `durationMs`; returns a cancel fn. */
function fadeValue(
	start: number,
	target: number,
	durationMs: number,
	apply: (value: number) => void,
	onDone?: () => void
): () => void {
	if (durationMs <= 0) {
		apply(target);
		onDone?.();
		return () => {};
	}
	const startAt = performance.now();
	const timer = setInterval(() => {
		const progress = Math.min(1, (performance.now() - startAt) / durationMs);
		apply(start + (target - start) * progress);
		if (progress >= 1) {
			clearInterval(timer);
			onDone?.();
		}
	}, FADE_TICK_MS);
	return () => clearInterval(timer);
}

function applyVolume(entry: ActiveBgm): void {
	if (entry.audio) {
		entry.audio.volume = Math.max(
			0,
			Math.min(1, entry.baseVolume * entry.volumeFactor * entry.duckFactor)
		);
	}
}

/**
 * One BGM per player (a device can serve several Player assets). Looping BGM
 * acks on playback start, non-looping on end — the wire contract. done() is
 * idempotent, so every termination path may call it.
 *
 * Every track shows an overlay chip (rendered in test sessions only).
 * Placeholder BGM (url null) simulates for durationMs; looping placeholders
 * ack immediately and stay until stopped.
 *
 * Fades come from the BGM asset via the play wire: fadeInMs ramps from 0 on
 * play; fadeOutMs is stored and applied when the track is stopped or replaced
 * (replacement = crossfade — the old track ramps down detached while the new
 * one starts). A stop with fade acks immediately (apply semantics) and
 * releases the audio element after the ramp.
 *
 * Ducking: the engine calls setDuck while dialogue/SFX with a duck config is
 * active on the player; the factor multiplies onto the fade volume and also
 * applies to a BGM that starts mid-duck.
 */
export class BgmChannel {
	private readonly active = new Map<string, ActiveBgm>();
	/** Explicit base volume per player; kept so later tracks inherit it. */
	private readonly volumeFactors = new Map<string, number>();
	/** Current duck factor per player; kept so a new track starts ducked. */
	private readonly duckFactors = new Map<string, number>();
	/** Detached fade-outs still ramping; killed instantly by stopAll (reset). */
	private readonly fadingOut = new Set<{
		audio: HTMLAudioElement;
		cancel: () => void;
	}>();

	play(cmd: WirePlayBgm, done: DoneFn): void {
		this.stop(cmd.playerId); // replace: ack the old one out (crossfade)
		stage.addPlaceholder({ id: cmd.id, channel: 'bgm', name: cmd.assetName });

		if (cmd.url === null || cmd.fileKey === null) {
			const entry: ActiveBgm = {
				audio: null,
				baseVolume: 1,
				volumeFactor: this.volumeFactors.get(cmd.playerId) ?? 1,
				duckFactor: 1,
				cancelSimulation: null,
				cancelFade: null,
				cancelDuck: null,
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

		const audio = createAudio(cmd.fileKey, cmd.url);
		audio.loop = cmd.loop;
		const entry: ActiveBgm = {
			audio,
			baseVolume: cmd.fadeInMs > 0 ? 0 : 1,
			volumeFactor: this.volumeFactors.get(cmd.playerId) ?? 1,
			duckFactor: this.duckFactors.get(cmd.playerId) ?? 1,
			cancelSimulation: null,
			cancelFade: null,
			cancelDuck: null,
			fadeOutMs: cmd.fadeOutMs,
			commandId: cmd.id,
			done
		};
		this.active.set(cmd.playerId, entry);
		applyVolume(entry);
		if (cmd.fadeInMs > 0) {
			entry.cancelFade = fadeValue(
				0,
				1,
				cmd.fadeInMs,
				(value) => {
					entry.baseVolume = value;
					applyVolume(entry);
				},
				() => {
					entry.cancelFade = null;
				}
			);
		}
		if (cmd.loop) {
			audio.addEventListener('playing', () => done(), { once: true });
		} else {
			audio.addEventListener('ended', () => {
				this.active.delete(cmd.playerId);
				stage.removePlaceholder(cmd.id);
				done();
			});
		}
		audio.addEventListener('error', () => {
			this.active.delete(cmd.playerId);
			stage.removePlaceholder(cmd.id);
			done('failed');
		});
		void audio.play().catch(() => done('failed'));
	}

	/** Applies and remembers a direct BGM base-volume adjustment. */
	setVolume(playerId: string, value: number): void {
		const factor = Math.max(0, Math.min(1, value));
		if (factor >= 1) this.volumeFactors.delete(playerId);
		else this.volumeFactors.set(playerId, factor);
		const entry = this.active.get(playerId);
		if (!entry) return;
		entry.volumeFactor = factor;
		applyVolume(entry);
	}

	/**
	 * Ramps the player's duck factor (1 = no duck). Remembered per player so a
	 * track that starts while dialogue/SFX still plays comes in already ducked.
	 */
	setDuck(playerId: string, factor: number): void {
		if (factor >= 1) this.duckFactors.delete(playerId);
		else this.duckFactors.set(playerId, factor);
		const entry = this.active.get(playerId);
		if (!entry?.audio) return;
		entry.cancelDuck?.();
		entry.cancelDuck = fadeValue(
			entry.duckFactor,
			factor,
			DUCK_RAMP_MS,
			(value) => {
				entry.duckFactor = value;
				applyVolume(entry);
			},
			() => {
				entry.cancelDuck = null;
			}
		);
	}

	stop(playerId: string, opts: { instant?: boolean } = {}): void {
		const entry = this.active.get(playerId);
		if (!entry) return;
		this.active.delete(playerId);
		entry.cancelSimulation?.();
		entry.cancelFade?.();
		entry.cancelDuck?.();
		stage.removePlaceholder(entry.commandId);
		const { audio } = entry;
		if (audio) {
			const fadeOutMs = opts.instant ? 0 : entry.fadeOutMs;
			if (fadeOutMs > 0) {
				const detached = {
					audio,
					cancel: () => {}
				};
				// Detached ramp works on the audible volume directly — the duck
				// factor is frozen at its detach-time value.
				detached.cancel = fadeValue(
					audio.volume,
					0,
					fadeOutMs,
					(value) => {
						audio.volume = value;
					},
					() => {
						this.fadingOut.delete(detached);
						audio.pause();
						audio.removeAttribute('src');
					}
				);
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
		for (const playerId of [...this.active.keys()]) this.stop(playerId, { instant: true });
		for (const detached of [...this.fadingOut]) {
			detached.cancel();
			detached.audio.pause();
			detached.audio.removeAttribute('src');
		}
		this.fadingOut.clear();
		this.volumeFactors.clear();
		this.duckFactors.clear();
	}
}
