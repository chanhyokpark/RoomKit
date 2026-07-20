import type { DoneFn } from '@roomkit/client';
import type { WirePlayVideo } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { resolveSrc } from './resolve';

/**
 * The stage has a single video surface, so one video plays at a time — a new
 * play replaces (and acks) the previous one. The <video> element lives in
 * Stage.svelte and reports ended/error back here.
 */
export class VideoChannel {
	private active: { playerId: string; commandId: string; done: DoneFn } | null = null;

	play(cmd: WirePlayVideo, done: DoneFn): void {
		this.finish();
		this.active = { playerId: cmd.playerId, commandId: cmd.id, done };
		stage.videoSrc = resolveSrc(cmd.fileKey, cmd.url);
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
		const active = this.active;
		if (!active) return;
		this.active = null;
		stage.removeSkippable(active.commandId);
		active.done(status);
	}
}
