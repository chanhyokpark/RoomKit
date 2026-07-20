import type { RoomKitClient } from '@roomkit/client';
import type { WirePlayCommand, WireStop } from '@roomkit/shared';
import { stage } from '../stores/stage.svelte';
import { BgmChannel } from './bgm';
import { DialogueChannel } from './dialogue';
import { SfxChannel } from './sfx';
import { VideoChannel } from './video';

/**
 * Routes wire commands from the device connection into the four playback
 * channels. Every play command is eventually done()'d on all termination
 * paths (end / replace / stop / reset / skip / error) — the client makes
 * done() idempotent and dedupes redeliveries, so channels don't need to.
 */
export class PlaybackEngine {
	readonly bgm = new BgmChannel();
	readonly sfx = new SfxChannel();
	readonly video = new VideoChannel();
	readonly dialogue: DialogueChannel;

	constructor(client: RoomKitClient) {
		this.dialogue = new DialogueChannel((commandId, lineIndex) =>
			client.sendProgress(commandId, lineIndex)
		);
		client.on('play', (cmd, done) => this.onPlay(cmd, done));
		client.on('stop', (cmd) => this.onStop(cmd));
		client.on('progress', (progress) => this.dialogue.onProgress(progress));
		client.on('reset', () => this.resetAll());
		client.on('navigate', (url) => {
			stage.iframeUrl = url;
		});
	}

	private onPlay(cmd: WirePlayCommand, done: (status?: 'done' | 'failed') => void): void {
		switch (cmd.channel) {
			case 'bgm':
				this.bgm.play(cmd, done);
				break;
			case 'sfx':
				this.sfx.play(cmd, done);
				break;
			case 'video':
				this.video.play(cmd, done);
				break;
			case 'dialogue':
				this.dialogue.play(cmd, done);
				break;
		}
	}

	private onStop(cmd: WireStop): void {
		switch (cmd.channel) {
			case 'bgm':
				this.bgm.stop(cmd.playerId);
				break;
			case 'sfx':
				this.sfx.stop(cmd.playerId);
				break;
			case 'video':
				this.video.stop(cmd.playerId);
				break;
			case 'dialogue':
				this.dialogue.stop(cmd.playerId);
				break;
		}
	}

	/** Wire reset: device returns to its initial (idle black) state. */
	resetAll(): void {
		this.bgm.stopAll();
		this.sfx.stopAll();
		this.video.stopAll();
		this.dialogue.stopAll();
		stage.clear();
	}
}
