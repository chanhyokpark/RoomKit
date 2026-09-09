import type { RoomKitClient } from '@roomkit/client';
import type { DeviceCallState, HelperCallState } from '@roomkit/shared';
import type { MediaConnection, Peer } from 'peerjs';
import { runHaptics } from '../haptics';
import { vlog } from '../log';
import { silentAudioStream } from '../mic';
import type { PlaybackEngine } from '../playback/engine';
import { config } from './config.svelte';
import { connection } from './connection.svelte';

/** Vibration on an incoming/accepted call. */
const RING_VIBRATE_MS = 400;

/**
 * Voice call with the operator for this stage window. The server sequences
 * the call (one per session, owned by an operator socket); this store does
 * the media: on `connecting` it opens a PeerJS peer as the server-assigned
 * id, captures the microphone and calls the operator's peer. Without mic
 * permission the call still goes through listen-only (a silent track stands
 * in for the mic) so the operator can at least be heard; `micDenied` lets
 * the overlay say so. Playback is muted for the call's duration.
 *
 * The site drives requests through the helper bridge (`request`/`cancel`);
 * a request is only ever withdrawn while pending — once an operator accepted,
 * the server's state wins and the player waits for its `ended`.
 */
class CallStore {
	state = $state<HelperCallState>('idle');
	callId = $state<string | null>(null);
	/** A cancel was sent; the button stays disabled until the server answers. */
	cancelling = $state(false);
	/** The current call runs listen-only because microphone access was refused. */
	micDenied = $state(false);

	private client: RoomKitClient | null = null;
	private engine: PlaybackEngine | null = null;
	private peer: Peer | null = null;
	private conn: MediaConnection | null = null;
	/** Stops the mic tracks, or tears down the silent stand-in. */
	private releaseMic: (() => void) | null = null;
	private audio: HTMLAudioElement | null = null;
	private readonly cleanups: (() => void)[] = [];

	attach(client: RoomKitClient, engine: PlaybackEngine): void {
		this.detach();
		this.client = client;
		this.engine = engine;
		const onCallState = (payload: DeviceCallState) => this.onServerState(payload);
		const onStatus = (status: string) => {
			// The socket is gone: the server ends the call on our offline; end
			// here too so the mic never outlives the session link.
			if ((status === 'disconnected' || status === 'error') && this.state !== 'idle') {
				this.reportFailed('device_disconnected');
				this.endLocally();
			}
		};
		client.on('callState', onCallState).on('status', onStatus);
		this.cleanups.push(() => {
			client.off('callState', onCallState).off('status', onStatus);
		});
	}

	detach(): void {
		this.endLocally();
		for (const cleanup of this.cleanups.splice(0)) cleanup();
		this.client = null;
		this.engine = null;
	}

	/** Site-initiated request (helper bridge). Rejects with the refusal reason. */
	async request(): Promise<void> {
		if (!this.client) throw new Error('not connected');
		if (connection.isTest) throw new Error('test_session');
		if (this.state !== 'idle') throw new Error('busy');
		const { callId } = await this.client.requestCall();
		// A connecting state may have raced in (operator started a call while
		// the request was in flight) — never regress it.
		if (this.state !== 'idle') return;
		this.callId = callId;
		this.state = 'requesting';
		vlog('call', 'requested', callId);
	}

	/** Withdraw a pending request; no-op once connecting. */
	cancel(): void {
		if (this.state !== 'requesting' || !this.callId || !this.client) return;
		this.cancelling = true;
		this.client.cancelCall(this.callId);
	}

	private onServerState(payload: DeviceCallState): void {
		vlog('call', 'server state', payload);
		if (payload.status === 'ended') {
			if (this.callId !== null && this.callId !== payload.callId) return;
			this.endLocally();
			return;
		}
		// connecting
		if (this.callId !== null && this.callId !== payload.callId) this.endLocally();
		this.callId = payload.callId;
		this.cancelling = false;
		this.state = 'connecting';
		void runHaptics({ kind: 'vibrate', duration: RING_VIBRATE_MS }).catch(() => {});
		this.engine?.setMuted(true);
		void this.startMedia(payload);
	}

	private async startMedia(
		payload: Extract<DeviceCallState, { status: 'connecting' }>
	): Promise<void> {
		const { callId } = payload;
		const live = () => this.callId === callId && this.state !== 'idle';
		let mic: MediaStream;
		let releaseMic: () => void;
		let micDenied = false;
		try {
			mic = await navigator.mediaDevices.getUserMedia({ audio: true });
			releaseMic = () => {
				for (const track of mic.getTracks()) track.stop();
			};
		} catch (err) {
			// No microphone (permission refused, or none attached): continue
			// listen-only rather than dropping the call.
			vlog('call', 'mic unavailable, continuing listen-only', err);
			micDenied = true;
			try {
				({ stream: mic, release: releaseMic } = silentAudioStream());
			} catch (audioErr) {
				vlog('call', 'silent track failed', audioErr);
				if (live()) this.fail('mic_denied');
				return;
			}
		}
		if (!live()) {
			releaseMic();
			return;
		}
		this.releaseMic = releaseMic;
		this.micDenied = micDenied;
		let PeerCtor: typeof Peer;
		try {
			({ Peer: PeerCtor } = await import('peerjs'));
		} catch (err) {
			vlog('call', 'peerjs load failed', err);
			if (live()) this.fail('peer_load');
			return;
		}
		if (!live()) return;
		const url = new URL(config.serverUrl);
		const secure = url.protocol === 'https:';
		const peer = new PeerCtor(payload.devicePeerId, {
			host: url.hostname,
			port: url.port ? Number(url.port) : secure ? 443 : 80,
			path: '/peerjs',
			secure,
			...(payload.iceServers ? { config: { iceServers: payload.iceServers } } : {})
		});
		this.peer = peer;
		peer.on('open', () => {
			if (!live() || this.peer !== peer) return;
			vlog('call', 'peer open, calling', payload.adminPeerId);
			const conn = peer.call(payload.adminPeerId, mic);
			this.conn = conn;
			conn.on('stream', (remote) => {
				if (!live() || this.conn !== conn) return;
				const audio = new Audio();
				audio.autoplay = true;
				audio.srcObject = remote;
				void audio.play().catch((err) => vlog('call', 'remote audio play failed', err));
				this.audio = audio;
				this.state = 'connected';
				this.client?.reportCallStatus(callId, 'connected', micDenied ? 'mic_denied' : undefined);
			});
			conn.on('close', () => {
				if (live() && this.conn === conn) this.fail('peer_closed');
			});
			conn.on('error', (err) => {
				vlog('call', 'media connection error', err);
				if (live() && this.conn === conn) this.fail('peer_closed');
			});
		});
		peer.on('error', (err) => {
			vlog('call', 'peer error', err);
			if (live() && this.peer === peer) this.fail(`peer_error:${err.type}`);
		});
		peer.on('disconnected', () => {
			// Signaling dropped; media keeps flowing. Reconnect so the server
			// keeps seeing the peer registered.
			if (live() && this.peer === peer && !peer.destroyed) peer.reconnect();
		});
	}

	private fail(reason: string): void {
		vlog('call', 'failed', reason);
		this.reportFailed(reason);
		this.endLocally();
	}

	private reportFailed(reason: string): void {
		if (this.callId && this.state !== 'idle' && this.state !== 'requesting') {
			this.client?.reportCallStatus(this.callId, 'failed', reason);
		}
	}

	private endLocally(): void {
		const conn = this.conn;
		const peer = this.peer;
		const releaseMic = this.releaseMic;
		const audio = this.audio;
		this.conn = null;
		this.peer = null;
		this.releaseMic = null;
		this.audio = null;
		try {
			conn?.close();
		} catch {
			// already closed
		}
		peer?.destroy();
		releaseMic?.();
		if (audio) {
			audio.pause();
			audio.srcObject = null;
		}
		if (this.state !== 'idle') vlog('call', 'ended locally');
		this.engine?.setMuted(false);
		this.state = 'idle';
		this.callId = null;
		this.cancelling = false;
		this.micDenied = false;
	}
}

export const call = new CallStore();
