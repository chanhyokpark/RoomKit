import type { DoneFn } from '@roomkit/client';
import type { PlaybackProgress, WirePlayDialogue } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { resolveSrc } from './resolve';

interface ActiveDialogue {
	cmd: WirePlayDialogue;
	done: DoneFn;
	audio: HTMLAudioElement | null;
	aborted: boolean;
}

/**
 * Dialogue playback per player.
 *
 * - speaker/both: play lines sequentially, reporting each line start via
 *   `progress` (the server relays it to the screen device); the final ack
 *   ends the dialogue server-side. A broken line file is skipped so it can't
 *   hang a waitUntilEnd sequence.
 * - screen: ack immediately (the server waits on the speaker), render the
 *   relayed line's subtitle; `lineIndex >= lines.length` is the end sentinel.
 * - 'both' renders its own subtitles locally and ignores the relay.
 */
export class DialogueChannel {
	private readonly active = new Map<string, ActiveDialogue>();

	constructor(private readonly reportProgress: (commandId: string, lineIndex: number) => void) {}

	play(cmd: WirePlayDialogue, done: DoneFn): void {
		this.stop(cmd.playerId);
		const entry: ActiveDialogue = { cmd, done, audio: null, aborted: false };
		this.active.set(cmd.playerId, entry);
		if (cmd.role === 'screen') {
			done();
			return;
		}
		stage.addSkippable({
			id: cmd.id,
			kind: 'dialogue',
			skip: () => this.endSpeaker(entry, 'done')
		});
		void this.runSpeaker(entry);
	}

	/** Relayed from the speaker device (screen role only). */
	onProgress(progress: PlaybackProgress): void {
		for (const entry of this.active.values()) {
			const { cmd } = entry;
			if (cmd.id !== progress.commandId || cmd.role !== 'screen') continue;
			if (progress.lineIndex >= cmd.lines.length) {
				this.endScreen(entry);
			} else {
				this.showLine(cmd, progress.lineIndex);
			}
		}
	}

	/** Wire stop: also clears any visible subtitle (wire contract). */
	stop(playerId: string): void {
		const entry = this.active.get(playerId);
		if (!entry) return;
		this.teardown(entry);
		stage.subtitle = null;
		entry.done();
	}

	stopAll(): void {
		for (const playerId of [...this.active.keys()]) this.stop(playerId);
	}

	private async runSpeaker(entry: ActiveDialogue): Promise<void> {
		const { cmd } = entry;
		let failures = 0;
		for (let i = 0; i < cmd.lines.length; i++) {
			if (entry.aborted) return;
			this.reportProgress(cmd.id, i);
			if (cmd.role === 'both') this.showLine(cmd, i);
			const line = cmd.lines[i];
			const ok = await this.playLine(entry, resolveSrc(line.fileKey, line.url));
			if (!ok) failures++;
		}
		if (entry.aborted) return;
		const allFailed = cmd.lines.length > 0 && failures === cmd.lines.length;
		this.endSpeaker(entry, allFailed ? 'failed' : 'done');
	}

	private playLine(entry: ActiveDialogue, src: string): Promise<boolean> {
		return new Promise((resolve) => {
			const audio = new Audio(src);
			entry.audio = audio;
			audio.addEventListener('ended', () => resolve(true));
			audio.addEventListener('error', () => resolve(false));
			void audio.play().catch(() => resolve(false));
		});
	}

	/** Natural end or skip of a speaker/both dialogue. */
	private endSpeaker(entry: ActiveDialogue, status: 'done' | 'failed'): void {
		this.teardown(entry);
		if (entry.cmd.role === 'both' && !entry.cmd.keepSubtitleAfterEnd) {
			stage.subtitle = null;
		}
		entry.done(status);
	}

	/** End sentinel for a screen-role dialogue. */
	private endScreen(entry: ActiveDialogue): void {
		this.teardown(entry);
		if (!entry.cmd.keepSubtitleAfterEnd) stage.subtitle = null;
	}

	private showLine(cmd: WirePlayDialogue, lineIndex: number): void {
		const line = cmd.lines[lineIndex];
		if (!line) return;
		stage.subtitle = { html: line.subtitleHtml, css: cmd.subtitleCss };
	}

	private teardown(entry: ActiveDialogue): void {
		entry.aborted = true;
		if (entry.audio) {
			entry.audio.pause();
			entry.audio.removeAttribute('src');
			entry.audio = null;
		}
		stage.removeSkippable(entry.cmd.id);
		if (this.active.get(entry.cmd.playerId) === entry) {
			this.active.delete(entry.cmd.playerId);
		}
	}
}
