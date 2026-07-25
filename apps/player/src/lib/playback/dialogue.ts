import type { DoneFn } from '@roomkit/client';
import type { PlaybackProgress, WireDialogueLine, WirePlayDialogue } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { resolveSrc } from './resolve';
import { simulate } from './simulate';

interface ActiveDialogue {
	cmd: WirePlayDialogue;
	done: DoneFn;
	audio: HTMLAudioElement | null;
	cancelSimulation: (() => void) | null;
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
 *
 * Placeholder lines (url null) simulate for durationMs; subtitles and the
 * progress relay behave exactly as with real files. A chip is shown while a
 * dialogue containing placeholder lines runs on the speaker.
 */
export class DialogueChannel {
	private readonly active = new Map<string, ActiveDialogue>();

	constructor(private readonly reportProgress: (commandId: string, lineIndex: number) => void) {}

	play(cmd: WirePlayDialogue, done: DoneFn): void {
		this.stop(cmd.playerId);
		const entry: ActiveDialogue = {
			cmd,
			done,
			audio: null,
			cancelSimulation: null,
			aborted: false
		};
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
		if (cmd.lines.some((line) => line.url === null)) {
			stage.addPlaceholder({ id: cmd.id, channel: 'dialogue', name: cmd.assetName });
		}
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
			const ok = await this.playLine(entry, cmd.lines[i]);
			if (!ok) failures++;
		}
		if (entry.aborted) return;
		const allFailed = cmd.lines.length > 0 && failures === cmd.lines.length;
		this.endSpeaker(entry, allFailed ? 'failed' : 'done');
	}

	private playLine(entry: ActiveDialogue, line: WireDialogueLine): Promise<boolean> {
		if (line.url === null || line.fileKey === null) {
			// A teardown mid-line cancels the timer; the promise then never settles,
			// which is fine — runSpeaker is abandoned exactly like the audio path
			// whose 'ended' event never fires after teardown.
			return new Promise((resolve) => {
				entry.cancelSimulation = simulate(line.durationMs ?? 0, () => {
					entry.cancelSimulation = null;
					resolve(true);
				});
			});
		}
		const { fileKey, url } = line;
		return new Promise((resolve) => {
			const audio = new Audio(resolveSrc(fileKey, url));
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
		stage.subtitle = {
			html: line.subtitleHtml,
			css: cmd.subtitleCss,
			params: cmd.params,
			lineIndex,
			lineCount: cmd.lines.length
		};
	}

	private teardown(entry: ActiveDialogue): void {
		entry.aborted = true;
		entry.cancelSimulation?.();
		entry.cancelSimulation = null;
		if (entry.audio) {
			entry.audio.pause();
			entry.audio.removeAttribute('src');
			entry.audio = null;
		}
		stage.removeSkippable(entry.cmd.id);
		stage.removePlaceholder(entry.cmd.id);
		if (this.active.get(entry.cmd.playerId) === entry) {
			this.active.delete(entry.cmd.playerId);
		}
	}
}
