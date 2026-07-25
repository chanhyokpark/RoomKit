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

	/**
	 * BGM duck coordinator: playerId → (commandId → duck factor) for every
	 * active dialogue/SFX whose wire carries `bgmDuck`. The lowest factor wins;
	 * a source registers at play and releases when its done() fires (all
	 * termination paths — end, stop, replace, reset, error, placeholder).
	 */
	private readonly duckSources = new Map<string, Map<string, number>>();

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
				this.sfx.play(cmd, this.withDuck(cmd, done, cmd.bgmDuck));
				break;
			case 'video':
				this.video.play(cmd, done);
				break;
			case 'dialogue':
				// Only roles that play audio duck (BGM shares the speaker device).
				this.dialogue.play(
					cmd,
					this.withDuck(cmd, done, cmd.role === 'screen' ? undefined : cmd.bgmDuck)
				);
				break;
		}
	}

	/** Registers a duck source for the command and releases it via done(). */
	private withDuck(
		cmd: { id: string; playerId: string },
		done: (status?: 'done' | 'failed') => void,
		factor: number | undefined
	): (status?: 'done' | 'failed') => void {
		if (factor === undefined || factor >= 1) return done;
		let sources = this.duckSources.get(cmd.playerId);
		if (!sources) this.duckSources.set(cmd.playerId, (sources = new Map()));
		sources.set(cmd.id, factor);
		this.applyDuck(cmd.playerId);
		return (status) => {
			this.releaseDuck(cmd.playerId, cmd.id);
			done(status);
		};
	}

	private releaseDuck(playerId: string, commandId: string): void {
		const sources = this.duckSources.get(playerId);
		if (!sources?.delete(commandId)) return;
		if (sources.size === 0) this.duckSources.delete(playerId);
		this.applyDuck(playerId);
	}

	private applyDuck(playerId: string): void {
		const sources = this.duckSources.get(playerId);
		const factor = sources?.size ? Math.min(...sources.values()) : 1;
		this.bgm.setDuck(playerId, factor);
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
		// Channel stops already released their duck sources via done(); this is
		// a backstop so a leaked source can't duck the next session's BGM.
		this.duckSources.clear();
		stage.clear();
	}
}
