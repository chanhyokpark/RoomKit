import { RoomKitClient, type ConnectionStatus } from '@roomkit/client';
import type { SessionState, Welcome } from '@roomkit/shared';
import { flushDeviceLogs } from '../device-logs';
import { verboseLogs, vlog } from '../log';
import { isTauri } from '../tauri';

/**
 * Owns this stage window's RoomKitClient (one window = one device) and
 * mirrors its events into runes the UI binds to. The client itself handles
 * reconnection and command dedupe/re-ack.
 */
class ConnectionStore {
	status = $state<ConnectionStatus>('idle');
	/** connect_error message while connecting/errored (e.g. invalid_code). */
	detail = $state<string | undefined>(undefined);
	welcome = $state<Welcome | null>(null);
	session = $state<SessionState | null>(null);
	/** When `session` was received — timerRemainingMs is a snapshot; clients tick locally. */
	sessionReceivedAt = $state(0);

	client: RoomKitClient | null = null;
	/** Operator-facing label of this window's device, for log events. */
	#deviceLabel: string | null = null;
	/** Was connected at least once, then lost it — the next connect is a reconnect. */
	#lostConnection = false;

	get isTest(): boolean {
		return this.session?.mode === 'test';
	}

	start(serverUrl: string, deviceCode: string, deviceName?: string): RoomKitClient {
		this.stop();
		// retryOnFatalError: room devices boot before the session (or their
		// test code) exists — keep polling instead of dying on invalid_code.
		// persistTestCode off: all stage windows share one localStorage origin,
		// so the lib's single stored code would make every window attach as the
		// same device. The launcher config is the source of truth for codes.
		this.#deviceLabel = deviceName ?? null;
		this.#lostConnection = false;
		const client = new RoomKitClient({
			serverUrl,
			deviceCode,
			deviceName,
			retryOnFatalError: true,
			persistTestCode: false,
			// Tauri builds forward console output to the log plugin, so the
			// socket's own trace is what the log dialog shows for this device.
			debug: verboseLogs || isTauri()
		});
		this.client = client;
		client.on('status', (status, detail) => {
			const previous = this.status;
			this.status = status;
			this.detail = detail;
			if (status === 'connected' && this.#lostConnection) {
				this.#lostConnection = false;
				vlog('connection', `reconnected "${this.#deviceLabel ?? ''}" (was ${previous})`);
				flushDeviceLogs();
			} else if (
				previous === 'connected' &&
				(status === 'disconnected' || status === 'error' || status === 'connecting')
			) {
				this.#lostConnection = true;
			}
		});
		client.on('welcome', (welcome) => {
			this.welcome = welcome;
			this.applySession(welcome.session);
		});
		client.on('sessionState', (session) => this.applySession(session));
		client.connect();
		return client;
	}

	private applySession(session: SessionState | null): void {
		const wasEnded = this.session?.state === 'ended';
		this.session = session;
		this.sessionReceivedAt = Date.now();
		if (session?.state === 'ended' && !wasEnded) {
			vlog('connection', `session ended "${this.#deviceLabel ?? ''}"`, session.sessionId);
			flushDeviceLogs();
		}
	}

	stop(): void {
		this.client?.disconnect();
		this.client = null;
		this.status = 'idle';
		this.detail = undefined;
		this.welcome = null;
		this.session = null;
	}
}

export const connection = new ConnectionStore();
