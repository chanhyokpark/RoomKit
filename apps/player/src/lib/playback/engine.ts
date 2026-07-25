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
		this.dialogue = new DialogueChannel((commandId, lineIndex, waiting) =>
			client.sendProgress(commandId, lineIndex, waiting)
		);
		// A line-cue go-ahead sent while offline is lost; re-announce pending
		// holds so the server answers again.
		client.on('status', (status) => {
			if (status === 'connected') this.dialogue.reannounceHolds();
		});
		// The helper bridge reports delegated-video outcomes from the website.
		stage.videoDelegate = {
			ended: (commandId) => this.video.handleDelegatedEnded(commandId),
			error: (commandId) => this.video.handleDelegatedError(commandId),
			detach: () => this.video.handleDetach()
		};
		client.on('play', (cmd, done) => this.onPlay(cmd, done));
		client.on('stop', (cmd) => this.onStop(cmd));
		client.on('progress', (progress) => this.dialogue.onProgress(progress));
		client.on('reset', () => this.resetAll());
		client.on('navigate', (url, cmd, done) => stage.navigate(url, done, cmd.force));
		client.on('hintCode', (cmd) => {
			stage.hintCode =
				cmd.code === null ? null : { code: cmd.code, css: cmd.css, params: cmd.params };
		});
		// Session end stops everything — otherwise looping BGM/video would play
		// into the next team's setup (and the server detaches the socket anyway).
		client.on('sessionState', (state) => {
			if (state.state === 'ended') this.resetAll();
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

	/** `playerId: null` = the "all players" stop for the channel. */
	private onStop(cmd: WireStop): void {
		switch (cmd.channel) {
			case 'bgm':
				if (cmd.playerId === null) this.bgm.stopAllPlayers();
				else this.bgm.stop(cmd.playerId);
				break;
			case 'sfx':
				if (cmd.playerId === null) this.sfx.stopAll();
				else this.sfx.stop(cmd.playerId);
				break;
			case 'video':
				if (cmd.playerId === null) this.video.stopAll();
				else this.video.stop(cmd.playerId);
				break;
			case 'dialogue':
				if (cmd.playerId === null) this.dialogue.stopAll();
				else this.dialogue.stop(cmd.playerId);
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
