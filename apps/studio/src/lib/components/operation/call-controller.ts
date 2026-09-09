import type { MediaConnection, Peer } from 'peerjs';
import type { Socket } from 'socket.io-client';
import { AdminEvents, CallConfigSchema, type IceServer } from '@roomkit/shared';

/** Signaling round trips are local; this only covers a dead link. */
const CONFIG_TIMEOUT_MS = 5000;

/**
 * The operator side of one voice call: microphone, PeerJS peer, and the
 * remote audio. Opened before the server is asked to start/accept (the
 * device calls our peer id, so it must already be registered), and closed
 * whenever the server reports the call gone. Browser-only — peerjs is
 * imported lazily so SvelteKit's SSR never touches it.
 */
export class CallController {
	private peer: Peer | null = null;
	private mic: MediaStream | null = null;
	private conn: MediaConnection | null = null;
	private audio: HTMLAudioElement | null = null;
	private expectedPeerId: string | null = null;
	/**
	 * A call that arrived before `expect()`: the server tells the device to
	 * connect before our start/accept ack lands, so a fast device can ring
	 * first. Held until we learn which peer id to trust.
	 */
	private early: MediaConnection | null = null;

	constructor(
		private readonly socket: Socket,
		private readonly apiUrl: string
	) {}

	get active(): boolean {
		return this.peer !== null;
	}

	/**
	 * Captures the microphone and registers a peer; resolves with its id.
	 * Throws `mic_denied` or `peer_error` (already cleaned up).
	 */
	async open(): Promise<string> {
		this.close();
		let iceServers: IceServer[] | null = null;
		try {
			const raw: unknown = await this.socket
				.timeout(CONFIG_TIMEOUT_MS)
				.emitWithAck(AdminEvents.callConfig, {});
			const parsed = CallConfigSchema.safeParse(raw);
			if (parsed.success) iceServers = parsed.data.iceServers;
		} catch {
			// Old server or slow link: PeerJS defaults still work on a LAN.
		}
		try {
			this.mic = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			throw new Error('mic_denied');
		}
		const { Peer } = await import('peerjs');
		const url = new URL(this.apiUrl);
		const secure = url.protocol === 'https:';
		const peer = new Peer({
			host: url.hostname,
			port: url.port ? Number(url.port) : secure ? 443 : 80,
			path: '/peerjs',
			secure,
			...(iceServers ? { config: { iceServers } } : {})
		});
		this.peer = peer;
		peer.on('call', (conn) => this.onIncoming(conn));
		try {
			return await new Promise<string>((resolve, reject) => {
				peer.once('open', (id) => resolve(id));
				peer.once('error', (err) => reject(err));
			});
		} catch {
			this.close();
			throw new Error('peer_error');
		}
	}

	/** Only the device the server assigned may reach us; strays are dropped. */
	expect(devicePeerId: string): void {
		this.expectedPeerId = devicePeerId;
		const early = this.early;
		this.early = null;
		if (early) this.onIncoming(early);
	}

	private onIncoming(conn: MediaConnection): void {
		if (!this.mic) {
			conn.close();
			return;
		}
		if (!this.expectedPeerId) {
			this.early?.close();
			this.early = conn;
			return;
		}
		if (conn.peer !== this.expectedPeerId) {
			conn.close();
			return;
		}
		this.conn?.close();
		this.conn = conn;
		conn.answer(this.mic);
		conn.on('stream', (remote) => {
			if (this.conn !== conn) return;
			this.audio?.pause();
			const audio = new Audio();
			audio.autoplay = true;
			audio.srcObject = remote;
			void audio.play().catch(() => {});
			this.audio = audio;
		});
	}

	close(): void {
		const { peer, mic, conn, audio, early } = this;
		this.peer = null;
		this.mic = null;
		this.conn = null;
		this.audio = null;
		this.early = null;
		this.expectedPeerId = null;
		try {
			conn?.close();
			early?.close();
		} catch {
			// already closed
		}
		peer?.destroy();
		if (mic) for (const track of mic.getTracks()) track.stop();
		if (audio) {
			audio.pause();
			audio.srcObject = null;
		}
	}
}
