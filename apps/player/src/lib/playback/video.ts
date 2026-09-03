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
 * Placeholder video (url null) renders a centered card on the surface (test
 * sessions only — production keeps the surface black) and simulates for
 * durationMs; the skip button routes through finish() as usual. File-backed
 * plays get an overlay chip instead of the card.
 *
 * When the embedded website has claimed the video slot, playback is delegated:
 * no <video> element renders (videoSrc stays null); the site receives the
 * presigned URL plus — when cached — the file's bytes as a Blob (the site is
 * an https page, and WebKit blocks both tauri-protocol and loopback http srcs
 * there; the helper turns the Blob into a same-origin blob: URL), and its
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
			if (placeholder) {
				stage.delegatedVideo = {
					commandId: cmd.id,
					assetName: cmd.assetName,
					url: null,
					blob: null,
					durationMs: cmd.durationMs,
					frame: cmd.frame,
					params: cmd.params
				};
			} else {
				void this.playDelegated(cmd);
			}
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
		// Overlay chip for plays the centered card doesn't already announce.
		if (delegated || !placeholder) {
			stage.addPlaceholder({ id: cmd.id, channel: 'video', name: cmd.assetName });
		}
		stage.addSkippable({ id: cmd.id, kind: 'video', skip: () => this.finish() });
	}

	/**
	 * Delegated playback hands cached bytes over as a Blob: the claiming site
	 * is an https page and cannot load the loopback media server (WebKit
	 * blocks mixed content even from 127.0.0.1). The helper mints a
	 * same-origin blob: URL from it; `url` stays the presigned fallback —
	 * also what old helper bundles (ignoring `blob`) simply stream.
	 */
	private async playDelegated(cmd: WirePlayVideo): Promise<void> {
		const blob = await cache.blob(cmd.fileKey as string);
		// The read is async — bail if this playback was replaced meanwhile.
		if (this.active?.commandId !== cmd.id) return;
		if (blob) this.active.fallbackUrl = cmd.url;
		else void cache.ensure(cmd.fileKey as string, cmd.url as string);
		stage.delegatedVideo = {
			commandId: cmd.id,
			assetName: cmd.assetName,
			url: cmd.url,
			blob,
			durationMs: null,
			frame: cmd.frame,
			params: cmd.params
		};
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
				if (stage.delegatedVideo)
					stage.delegatedVideo = { ...stage.delegatedVideo, url, blob: null };
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
		stage.removePlaceholder(active.commandId);
		stage.removeSkippable(active.commandId);
		active.done(status);
	}
}
