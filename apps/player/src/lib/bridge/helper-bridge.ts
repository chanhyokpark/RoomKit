import type { RoomKitClient } from '@roomkit/client';
import {
	HelperToPlayerSchema,
	PLAYER_SOURCE,
	type HelperTimerGet,
	type HintError,
	type HintShow,
	type JsonValue,
	type PlayerToHelper,
	type WireMessage
} from '@roomkit/shared';

/**
 * Player side of the @roomkit/helper postMessage bridge (contract in
 * packages/shared/src/helper.ts): inbound envelopes are zod-validated and
 * must come from our iframe's contentWindow; outbound messages target the
 * navigated website's origin and are buffered until the helper's `hello`.
 */
export class HelperBridge {
	private ready = false;
	private buffered: PlayerToHelper[] = [];
	private readonly targetOrigin: string;
	private readonly cleanups: (() => void)[] = [];

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
		const onLoad = () => {
			this.ready = false;
		};
		iframe.addEventListener('load', onLoad);
		this.cleanups.push(() => iframe.removeEventListener('load', onLoad));

		const onMessage = (payload: Record<string, JsonValue>, envelope: WireMessage) =>
			this.send({
				source: PLAYER_SOURCE,
				type: 'message',
				messageId: envelope.messageId,
				messageName: envelope.messageName,
				payload
			});
		const onHint = (hint: HintShow) => this.send({ source: PLAYER_SOURCE, type: 'hint:show', hint });
		const onHintError = (error: HintError) =>
			this.send({ source: PLAYER_SOURCE, type: 'hint:error', error });
		this.client.on('message', onMessage).on('hint', onHint).on('hintError', onHintError);
		this.cleanups.push(() => {
			this.client.off('message', onMessage).off('hint', onHint).off('hintError', onHintError);
		});
	}

	destroy(): void {
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.buffered = [];
	}

	private receive(event: MessageEvent): void {
		if (event.source !== this.iframe.contentWindow) return;
		const parsed = HelperToPlayerSchema.safeParse(event.data);
		if (!parsed.success) return;
		const msg = parsed.data;
		switch (msg.type) {
			case 'hello': {
				this.ready = true;
				for (const queued of this.buffered.splice(0)) this.post(queued);
				return;
			}
			case 'trigger':
				this.client.trigger(msg.event, msg.payload);
				return;
			case 'hint:submit':
				this.client.submitHint(msg.code);
				return;
			case 'hint:next':
				this.client.requestHintStep(msg.hintId, msg.step);
				return;
			case 'timer:get':
				void this.answerTimer(msg);
				return;
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
			this.buffered.push(msg);
			return;
		}
		this.post(msg);
	}

	private post(msg: PlayerToHelper): void {
		this.iframe.contentWindow?.postMessage(msg, this.targetOrigin);
	}
}
