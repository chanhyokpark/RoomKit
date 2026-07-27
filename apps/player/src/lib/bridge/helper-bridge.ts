import type { RoomKitClient } from '@roomkit/client';
import {
	HelperToPlayerSchema,
	PLAYER_SOURCE,
	type HelperTimerGet,
	type HintError,
	type HintShow,
	type JsonValue,
	type PlayerHintCode,
	type PlayerSubtitle,
	type PlayerToHelper,
	type PlayerVideoPlay,
	type WireMessage
} from '@roomkit/shared';
import { connection } from '../stores/connection.svelte';
import { vlog } from '../log';
import { stage } from '../stores/stage.svelte';

/**
 * Player side of the @roomkit/helper postMessage bridge (contract in
 * packages/shared/src/helper.ts): inbound envelopes are zod-validated and
 * must come from our iframe's contentWindow; outbound messages target the
 * navigated website's origin and are buffered until the helper's `hello`.
 *
 * Render claims arrive with `hello` and are dropped whenever the page goes
 * away (reload or destroy) — a non-claiming page restores player rendering.
 */
export class HelperBridge {
	private ready = false;
	/** A hello arrived after the previous iframe load event (or construction). */
	private helloSinceLoad = false;
	private buffered: PlayerToHelper[] = [];
	private readonly targetOrigin: string;
	private readonly cleanups: (() => void)[] = [];
	/** Awaited messages (`awaitHandled`) whose message:done hasn't arrived yet. */
	private readonly pendingMessages = new Map<
		string,
		{ resolve: () => void; reject: (err: Error) => void }
	>();
	/**
	 * Helper version from the last hello (null = old bundle without one),
	 * undefined until any hello arrived. Re-reported on every welcome — a full
	 * reconnect re-attaches the device and drops server-side version state.
	 */
	private helperVersion: string | null | undefined;

	constructor(
		private readonly iframe: HTMLIFrameElement,
		private readonly client: RoomKitClient,
		url: string
	) {
		this.targetOrigin = new URL(url).origin;

		const onWindowMessage = (event: MessageEvent) => this.receive(event);
		window.addEventListener('message', onWindowMessage);
		this.cleanups.push(() => window.removeEventListener('message', onWindowMessage));

		// A full reload inside the iframe (e.g. vite HMR during a website test)
		// swaps the document without re-creating the iframe: the new page must
		// `hello` again before it can receive, so buffer until then — otherwise
		// messages posted mid-reload land on a page that isn't listening yet.
		// Render claims die with the old page; the new page re-claims in hello.
		//
		// BUT the load event races the hello: the site's module script runs (and
		// posts hello) before its resources finish loading, and WKWebView also
		// fires a load for the iframe's initial about:blank. A hello received
		// since the previous load event therefore belongs to the document that
		// just finished loading — resetting then would wipe an established
		// handshake for good (the helper's hello is one-shot on old bundles).
		const onLoad = () => {
			if (!this.helloSinceLoad) {
				this.ready = false;
				stage.dropHelperClaims();
				// Awaited messages already delivered to the old document will never
				// be answered — fail them so the server sequence isn't left waiting.
				// Ones still buffered stay pending; they flush to the new page.
				this.failDeliveredPending('helper page went away');
			}
			this.helloSinceLoad = false;
		};
		iframe.addEventListener('load', onLoad);
		this.cleanups.push(() => iframe.removeEventListener('load', onLoad));

		const onMessage = (payload: Record<string, JsonValue>, envelope: WireMessage) => {
			if (!envelope.awaitHandled) {
				this.send({
					source: PLAYER_SOURCE,
					type: 'message',
					messageId: envelope.messageId,
					messageName: envelope.messageName,
					payload
				});
				return;
			}
			// Awaited message: forward the delivery id and hold the client's ack
			// (via the returned promise) until the helper reports message:done.
			this.send({
				source: PLAYER_SOURCE,
				type: 'message',
				messageId: envelope.messageId,
				messageName: envelope.messageName,
				payload,
				commandId: envelope.id
			});
			return new Promise<void>((resolve, reject) => {
				this.pendingMessages.set(envelope.id, { resolve, reject });
			});
		};
		const onHint = (hint: HintShow) => this.send({ source: PLAYER_SOURCE, type: 'hint:show', hint });
		const onHintError = (error: HintError) =>
			this.send({ source: PLAYER_SOURCE, type: 'hint:error', error });
		const onWelcome = () => {
			if (this.helperVersion !== undefined) this.client.reportHelperInfo(this.helperVersion);
		};
		this.client
			.on('message', onMessage)
			.on('hint', onHint)
			.on('hintError', onHintError)
			.on('welcome', onWelcome);
		this.cleanups.push(() => {
			this.client
				.off('message', onMessage)
				.off('hint', onHint)
				.off('hintError', onHintError)
				.off('welcome', onWelcome);
		});
	}

	destroy(): void {
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.buffered = [];
		stage.dropHelperClaims();
		for (const [id, pending] of this.pendingMessages) {
			this.pendingMessages.delete(id);
			pending.reject(new Error('bridge destroyed'));
		}
	}

	/**
	 * Reject pending awaited messages that already reached the (now gone) page.
	 * Ones still sitting in the buffer keep waiting — they will be flushed to
	 * the next page's hello and can still be answered.
	 */
	private failDeliveredPending(reason: string): void {
		const buffered = new Set<string>();
		for (const m of this.buffered) {
			if (m.type === 'message' && m.commandId !== undefined) buffered.add(m.commandId);
		}
		for (const [id, pending] of this.pendingMessages) {
			if (buffered.has(id)) continue;
			this.pendingMessages.delete(id);
			pending.reject(new Error(reason));
		}
	}

	/** Current subtitle for a claimed subtitle slot; null clears. */
	postSubtitle(subtitle: PlayerSubtitle['subtitle']): void {
		this.send({ source: PLAYER_SOURCE, type: 'subtitle', subtitle });
	}

	/** Current hint entry code for a claimed hintCode slot; null hides. */
	postHintCode(hintCode: PlayerHintCode['hintCode']): void {
		this.send({ source: PLAYER_SOURCE, type: 'hintCode', hintCode });
	}

	postVideoPlay(video: Omit<PlayerVideoPlay, 'source' | 'type'>): void {
		this.send({ source: PLAYER_SOURCE, type: 'video:play', ...video });
	}

	postVideoStop(commandId: string): void {
		this.send({ source: PLAYER_SOURCE, type: 'video:stop', commandId });
	}

	private receive(event: MessageEvent): void {
		if (event.source !== this.iframe.contentWindow) return;
		const parsed = HelperToPlayerSchema.safeParse(event.data);
		if (!parsed.success) {
			// Only warn for messages that claim to be from the helper — a silent
			// drop here means an invisible version mismatch with the site's bundle.
			if ((event.data as { source?: unknown } | null)?.source === 'roomkit-helper') {
				console.warn('[player] dropped malformed helper message', event.data, parsed.error);
			}
			return;
		}
		const msg = parsed.data;
		vlog('bridge', '← helper', msg.type, msg);
		switch (msg.type) {
			case 'hello': {
				this.ready = true;
				this.helloSinceLoad = true;
				stage.helperRenders = { ...msg.renders };
				// Studio warns about outdated helper bundles; null = a bundle
				// predating version reporting.
				this.helperVersion = msg.version ?? null;
				this.client.reportHelperInfo(this.helperVersion);
				// Replied to every hello so a reloaded page learns it again; test
				// mode keeps the site's context menu usable (devtools).
				this.post({
					source: PLAYER_SOURCE,
					type: 'mode',
					mode: connection.session?.mode ?? 'production'
				});
				for (const queued of this.buffered.splice(0)) this.post(queued);
				return;
			}
			case 'trigger': {
				const { requestId } = msg;
				if (requestId === undefined) {
					this.client.trigger(msg.event, msg.payload);
					return;
				}
				// Awaited trigger: relay the server's completion ack (or its failure)
				// back to the helper as a trigger:result.
				this.client
					.triggerAndWait(msg.event, msg.payload)
					.then(() =>
						this.send({ source: PLAYER_SOURCE, type: 'trigger:result', requestId, ok: true })
					)
					.catch(() =>
						this.send({ source: PLAYER_SOURCE, type: 'trigger:result', requestId, ok: false })
					);
				return;
			}
			case 'hint:submit':
				this.client.submitHint(msg.code);
				return;
			case 'hint:next':
				this.client.requestHintStep(msg.hintId, msg.step);
				return;
			case 'timer:get':
				void this.answerTimer(msg);
				return;
			case 'video:ended':
				stage.videoDelegate?.ended(msg.commandId);
				return;
			case 'video:error':
				stage.videoDelegate?.error(msg.commandId);
				return;
			case 'message:done': {
				const pending = this.pendingMessages.get(msg.commandId);
				if (!pending) return;
				this.pendingMessages.delete(msg.commandId);
				if (msg.ok) pending.resolve();
				else pending.reject(new Error('message handler failed'));
				return;
			}
		}
	}

	/** Never rejects: the client's resync is best-effort with a local fallback. */
	private async answerTimer(msg: HelperTimerGet): Promise<void> {
		const remainingMs = await this.client.getRemainingTime({ resync: msg.resync });
		this.send({
			source: PLAYER_SOURCE,
			type: 'timer',
			requestId: msg.requestId,
			remainingMs
		});
	}

	private send(msg: PlayerToHelper): void {
		if (!this.ready) {
			vlog('bridge', 'buffered until hello', msg.type, msg);
			this.buffered.push(msg);
			return;
		}
		this.post(msg);
	}

	private post(msg: PlayerToHelper): void {
		vlog('bridge', '→ helper', msg.type, msg);
		// Envelopes assembled from $state (stage.subtitle/delegatedVideo/…) carry
		// Svelte proxies in nested fields; structured clone rejects proxies, so a
		// raw postMessage throws DataCloneError — which kills the posting $effect
		// and with it the whole bridge. The wire shapes are plain JSON, so a JSON
		// round-trip deproxies losslessly — except a video:play's cached-media
		// Blob, which JSON flattens to {}: detach it and reattach afterwards
		// (structured clone handles Blob natively). The catch keeps a bad
		// envelope from ever tearing the bridge down again.
		try {
			const blob = msg.type === 'video:play' ? msg.blob : undefined;
			const envelope = JSON.parse(JSON.stringify(msg)) as PlayerToHelper;
			if (envelope.type === 'video:play') {
				if (blob instanceof Blob) envelope.blob = blob;
				else delete envelope.blob;
			}
			this.iframe.contentWindow?.postMessage(envelope, this.targetOrigin);
		} catch (err) {
			console.error('[player] bridge post failed', msg.type, err);
		}
	}
}
