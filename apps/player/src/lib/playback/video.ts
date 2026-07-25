import type { DoneFn } from '@roomkit/client';
import type { WirePlayVideo } from '@roomkit/shared';
import { cache } from '../cache/manager.svelte';
import { stage } from '../stores/stage.svelte';
import { resolveSrc } from './resolve';
import { simulate } from './simulate';

/**
 * The stage has a single video surface, so one video plays at a time — a new
 * play replaces (and acks) the previous one. The <video> element lives in
 * Stage.svelte and reports ended/error back here.
 *
 * Placeholder video (url null) renders a centered card on the surface and
 * simulates for durationMs; the skip button routes through finish() as usual.
 *
 * When the embedded website has claimed the video slot, playback is delegated:
 * no <video> element renders (videoSrc stays null); the site receives a
 * loopback media-server URL for cached video (a tauri-protocol src would be
 * unreachable cross-origin), falling back to the raw presigned URL, and its
 * video:ended/video:error report drives finish(). Placeholder videos keep the
 * local simulation for the ack even while delegated.
 */
export class VideoChannel {
	private active: {
		playerId: string;
		commandId: string;
		done: DoneFn;
		cancelSimulation: (() => void) | null;
		delegated: boolean;
		/** Presigned URL to retry once when the cached copy fails; null = none. */
		fallbackUrl: string | null;
		fileKey: string | null;
	} | null = null;

	play(cmd: WirePlayVideo, done: DoneFn): void {
		this.finish();
		const delegated = stage.helperRenders.video;
		this.active = {
			playerId: cmd.playerId,
			commandId: cmd.id,
			done,
			cancelSimulation: null,
			delegated,
			fallbackUrl: null,
			fileKey: cmd.fileKey
		};
		const placeholder = cmd.url === null || cmd.fileKey === null;
		if (delegated) {
			const src = placeholder ? null : (cache.httpSrc(cmd.fileKey as string) ?? cmd.url);
			if (src !== null && src !== cmd.url) this.active.fallbackUrl = cmd.url;
			stage.delegatedVideo = {
				commandId: cmd.id,
				assetName: cmd.assetName,
				url: src,
				durationMs: placeholder ? cmd.durationMs : null,
				frame: cmd.frame,
				params: cmd.params
			};
		} else {
			stage.videoFrame = cmd.frame;
			if (placeholder) {
				stage.videoPlaceholder = cmd.assetName;
			} else {
				const src = resolveSrc(cmd.fileKey as string, cmd.url as string);
				if (src !== cmd.url) this.active.fallbackUrl = cmd.url;
				stage.videoSrc = src;
			}
		}
		if (placeholder) {
			this.active.cancelSimulation = simulate(cmd.durationMs ?? 0, () => this.finish());
		}
		stage.addSkippable({ id: cmd.id, kind: 'video', skip: () => this.finish() });
	}

	stop(playerId: string): void {
		if (this.active?.playerId === playerId) this.finish();
	}

	stopAll(): void {
		this.finish();
	}

	handleEnded(): void {
		this.finish();
	}

	handleError(): void {
		if (stage.videoSrc === null) return;
		if (this.retryWithFallback((url) => (stage.videoSrc = url))) return;
		this.finish('failed');
	}

	/** The claiming website reported its delegated video finished. */
	handleDelegatedEnded(commandId: string): void {
		if (this.active?.delegated && this.active.commandId === commandId) this.finish();
	}

	/** The claiming website failed to play the delegated video. */
	handleDelegatedError(commandId: string): void {
		if (!this.active?.delegated || this.active.commandId !== commandId) return;
		if (
			this.retryWithFallback((url) => {
				if (stage.delegatedVideo) stage.delegatedVideo = { ...stage.delegatedVideo, url };
			})
		) {
			return;
		}
		this.finish('failed');
	}

	/**
	 * One-shot fallback for a failed cached copy (pruned by another window,
	 * corrupt file): swap in the presigned URL instead of failing the command.
	 */
	private retryWithFallback(apply: (url: string) => void): boolean {
		const active = this.active;
		if (!active?.fallbackUrl) return false;
		const url = active.fallbackUrl;
		active.fallbackUrl = null;
		if (active.fileKey) cache.invalidate(active.fileKey);
		console.warn('[player] cached video failed, falling back to presigned url', active.fileKey);
		apply(url);
		return true;
	}

	/**
	 * The claiming website went away (navigation/teardown) — its ended report
	 * will never arrive, so end the playback rather than hang a waitUntilEnd
	 * sequence. Placeholder simulations keep running to their own timer.
	 */
	handleDetach(): void {
		if (this.active?.delegated && this.active.cancelSimulation === null) this.finish();
	}

	private finish(status?: 'done' | 'failed'): void {
		stage.videoSrc = null;
		stage.videoPlaceholder = null;
		stage.videoFrame = null;
		stage.delegatedVideo = null;
		const active = this.active;
		if (!active) return;
		this.active = null;
		active.cancelSimulation?.();
		stage.removeSkippable(active.commandId);
		active.done(status);
	}
}
