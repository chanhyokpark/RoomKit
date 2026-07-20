import { RoomKitClient, type ConnectionStatus } from '@roomkit/client';
import type { SessionState, Welcome } from '@roomkit/shared';

/**
 * Owns this stage window's RoomKitClient (one window = one device) and
 * mirrors its events into runes the UI binds to. The client itself handles
 * reconnection, command dedupe/re-ack, and test-code persistence.
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

	get isTest(): boolean {
		return this.session?.mode === 'test';
	}

	start(serverUrl: string, deviceCode: string, deviceName?: string): RoomKitClient {
		this.stop();
		// retryOnFatalError: room devices boot before the session (or their
		// test code) exists — keep polling instead of dying on invalid_code.
		const client = new RoomKitClient({
			serverUrl,
			deviceCode,
			deviceName,
			retryOnFatalError: true
		});
		this.client = client;
		client.on('status', (status, detail) => {
			this.status = status;
			this.detail = detail;
		});
		client.on('welcome', (welcome) => {
			this.welcome = welcome;
			this.session = welcome.session;
			this.sessionReceivedAt = Date.now();
		});
		client.on('sessionState', (session) => {
			this.session = session;
			this.sessionReceivedAt = Date.now();
		});
		client.connect();
		return client;
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
