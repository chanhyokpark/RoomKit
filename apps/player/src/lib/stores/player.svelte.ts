import { io, type Socket } from 'socket.io-client';
import {
	PLAYER_NAMESPACE,
	PlayerEvents,
	PlayerTestStartSchema,
	PlayerWebsiteTestStartSchema,
	PlayerWebsiteTestStopSchema,
	type PlayerTestStart
} from '@roomkit/shared';
import {
	closeWebsiteTestWindows,
	openTestDeviceWindow,
	openWebsiteTestWindow
} from '../windows';
import { vlog } from '../log';
import { config } from './config.svelte';

export type PlayerStatus = 'idle' | 'connecting' | 'connected';

/**
 * The launcher's own connection to the server (/player namespace) — separate
 * from the per-window device sockets. Registers this player under its
 * configured name so studio can list it, and opens stage windows when the
 * server pushes a `test:start` for a studio-created test session.
 */
class PlayerStore {
	status = $state<PlayerStatus>('idle');
	lastTestStart = $state<PlayerTestStart | null>(null);

	#socket: Socket | null = null;
	#reconnectTimer: ReturnType<typeof setTimeout> | undefined;

	/** (Re)connects with the current config; call again after edits. */
	connect(): void {
		this.disconnect();
		const serverUrl = config.serverUrl.trim().replace(/\/$/, '');
		const playerName = config.playerName.trim();
		if (!serverUrl || !playerName || !config.playerId) return;
		this.status = 'connecting';
		const socket = io(`${serverUrl}${PLAYER_NAMESPACE}`, {
			transports: ['websocket', 'polling'],
			auth: { playerId: config.playerId, playerName }
		});
		this.#socket = socket;
		vlog('launcher', 'connecting', { serverUrl: `${serverUrl}${PLAYER_NAMESPACE}`, playerName });
		socket.on('connect', () => {
			vlog('launcher', 'connected');
			if (this.#socket === socket) this.status = 'connected';
		});
		socket.on('disconnect', (reason) => {
			vlog('launcher', 'disconnected:', reason);
			if (this.#socket === socket) this.status = 'connecting';
		});
		socket.on(PlayerEvents.testStart, (payload: unknown) => {
			const parsed = PlayerTestStartSchema.safeParse(payload);
			if (!parsed.success) {
				console.warn('[player:launcher] invalid test:start dropped', payload, parsed.error);
				return;
			}
			vlog('launcher', 'test:start', parsed.data);
			this.lastTestStart = parsed.data;
			void this.openWindows(parsed.data);
		});
		socket.on(PlayerEvents.websiteTestStart, (payload: unknown) => {
			const parsed = PlayerWebsiteTestStartSchema.safeParse(payload);
			if (!parsed.success) {
				console.warn('[player:launcher] invalid websiteTest:start dropped', payload, parsed.error);
				return;
			}
			vlog('launcher', 'websiteTest:start', parsed.data);
			void openWebsiteTestWindow(parsed.data.runId, parsed.data.device);
		});
		socket.on(PlayerEvents.websiteTestStop, (payload: unknown) => {
			const parsed = PlayerWebsiteTestStopSchema.safeParse(payload);
			if (!parsed.success) {
				console.warn('[player:launcher] invalid websiteTest:stop dropped', payload, parsed.error);
				return;
			}
			vlog('launcher', 'websiteTest:stop', parsed.data);
			void closeWebsiteTestWindows(parsed.data.runId);
		});
	}

	/** Debounced reconnect for oninput handlers (server URL / name edits). */
	reconnectSoon(): void {
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = setTimeout(() => this.connect(), 500);
	}

	disconnect(): void {
		this.#socket?.disconnect();
		this.#socket = null;
		this.status = 'idle';
	}

	private async openWindows(start: PlayerTestStart): Promise<void> {
		for (const device of start.devices) {
			await openTestDeviceWindow(start.sessionId, device);
		}
	}
}

export const player = new PlayerStore();
