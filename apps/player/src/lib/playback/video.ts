import type { DoneFn } from '@roomkit/client';
import type { WirePlayVideo } from '@roomkit/shared';
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
 */
export class VideoChannel {
	private active: {
		playerId: string;
		commandId: string;
		done: DoneFn;
		cancelSimulation: (() => void) | null;
		/** Drives videoTimeMs for placeholder video so components still get time. */
		timeTicker: ReturnType<typeof setInterval> | null;
	} | null = null;

	play(cmd: WirePlayVideo, done: DoneFn): void {
		this.finish();
		this.active = {
			playerId: cmd.playerId,
			commandId: cmd.id,
			done,
			cancelSimulation: null,
			timeTicker: null
		};
		stage.videoFrame = cmd.frame;
		stage.videoComponent = cmd.component;
		stage.videoTimeMs = 0;
		stage.videoDurationMs = cmd.durationMs;
		if (cmd.url === null || cmd.fileKey === null) {
			stage.videoPlaceholder = cmd.assetName;
			this.active.cancelSimulation = simulate(cmd.durationMs ?? 0, () => this.finish());
			const startedAt = performance.now();
			this.active.timeTicker = setInterval(() => {
				stage.videoTimeMs = performance.now() - startedAt;
			}, 200);
		} else {
			stage.videoSrc = resolveSrc(cmd.fileKey, cmd.url);
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
		if (stage.videoSrc !== null) this.finish('failed');
	}

	private finish(status?: 'done' | 'failed'): void {
		stage.videoSrc = null;
		stage.videoPlaceholder = null;
		stage.videoFrame = null;
		stage.videoComponent = null;
		stage.videoTimeMs = 0;
		stage.videoDurationMs = null;
		const active = this.active;
		if (!active) return;
		this.active = null;
		active.cancelSimulation?.();
		if (active.timeTicker !== null) clearInterval(active.timeTicker);
		stage.removeSkippable(active.commandId);
		active.done(status);
	}
}
