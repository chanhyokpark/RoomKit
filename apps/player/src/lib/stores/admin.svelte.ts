import { io, type Socket } from 'socket.io-client';
import { toast } from 'svelte-sonner';
import {
	ADMIN_NAMESPACE,
	AdminEvents,
	DeviceStatusSchema,
	SessionLogEntrySchema,
	SessionMediaSchema,
	SessionNotificationSchema,
	SessionRunsSchema,
	SessionStateSchema,
	type DeviceStatus,
	type RunningEvent,
	type SessionLogEntry,
	type SessionMedia,
	type SessionNotification,
	type SessionState
} from '@roomkit/shared';
import { vlog } from '../log';
import { auth } from './auth.svelte';
import { config } from './config.svelte';

const LOG_LIMIT = 500;

/**
 * The debug window's /admin socket, filtered to one session. Same live feed
 * studio's operation page consumes; controls go through the admin REST API.
 */
class AdminStore {
	connected = $state(false);
	session = $state<SessionState | null>(null);
	/** Epoch ms of the last session:state — base for local timer ticking. */
	sessionReceivedAt = $state(0);
	runs = $state<RunningEvent[]>([]);
	media = $state<SessionMedia | null>(null);
	deviceStatus = $state<Record<string, DeviceStatus>>({});
	/** Newest first, capped. */
	logs = $state<SessionLogEntry[]>([]);
	notifications = $state<SessionNotification[]>([]);

	#socket: Socket | null = null;
	#sessionId = '';
	#reloginTried = false;

	start(sessionId: string): void {
		const changedSession = this.#sessionId !== sessionId;
		this.stop();
		if (changedSession) this.notifications = [];
		this.#sessionId = sessionId;
		const serverUrl = config.serverUrl.trim().replace(/\/$/, '');
		const socket = io(`${serverUrl}${ADMIN_NAMESPACE}`, {
			transports: ['websocket', 'polling'],
			auth: { token: auth.token ?? '' }
		});
		this.#socket = socket;
		socket.on('connect', () => {
			vlog('debug', 'admin socket connected');
			this.connected = true;
			this.#reloginTried = false;
		});
		socket.on('disconnect', () => {
			this.connected = false;
		});
		socket.on('connect_error', (err) => {
			vlog('debug', 'admin socket error', err.message);
			// One silent re-login covers an expired JWT; further failures are
			// surfaced by the disconnected badge.
			if (!this.#reloginTried) {
				this.#reloginTried = true;
				void auth.relogin().then((ok) => {
					if (ok && this.#sessionId === sessionId) this.start(sessionId);
				});
			}
		});
		socket.on(AdminEvents.sessionState, (payload: unknown) => {
			const parsed = SessionStateSchema.safeParse(payload);
			if (!parsed.success || parsed.data.sessionId !== this.#sessionId) return;
			this.session = parsed.data;
			this.sessionReceivedAt = Date.now();
		});
		socket.on(AdminEvents.sessionRuns, (payload: unknown) => {
			const parsed = SessionRunsSchema.safeParse(payload);
			if (!parsed.success || parsed.data.sessionId !== this.#sessionId) return;
			this.runs = parsed.data.runs;
		});
		socket.on(AdminEvents.sessionMedia, (payload: unknown) => {
			const parsed = SessionMediaSchema.safeParse(payload);
			if (!parsed.success || parsed.data.sessionId !== this.#sessionId) return;
			this.media = parsed.data;
		});
		socket.on(AdminEvents.deviceStatus, (payload: unknown) => {
			const parsed = DeviceStatusSchema.safeParse(payload);
			if (!parsed.success || parsed.data.sessionId !== this.#sessionId) return;
			this.deviceStatus = { ...this.deviceStatus, [parsed.data.deviceId]: parsed.data };
		});
		socket.on(AdminEvents.log, (payload: unknown) => {
			const parsed = SessionLogEntrySchema.safeParse(payload);
			if (!parsed.success || parsed.data.sessionId !== this.#sessionId) return;
			this.appendLogs([parsed.data]);
		});
		socket.on(AdminEvents.notification, (payload: unknown) => {
			const parsed = SessionNotificationSchema.safeParse(payload);
			if (!parsed.success || parsed.data.sessionId !== this.#sessionId) return;
			this.notifications = [parsed.data, ...this.notifications].slice(0, 5);
			toast.info(parsed.data.message, { duration: 10_000 });
		});
	}

	/** Merge (REST backfill or live) entries, dedupe by id, newest first. */
	appendLogs(entries: SessionLogEntry[]): void {
		const byId = new Map<number, SessionLogEntry>();
		for (const entry of [...this.logs, ...entries]) byId.set(entry.id, entry);
		this.logs = [...byId.values()].sort((a, b) => b.id - a.id).slice(0, LOG_LIMIT);
	}

	stop(): void {
		this.#socket?.disconnect();
		this.#socket = null;
		this.#sessionId = '';
		this.connected = false;
	}
}

export const admin = new AdminStore();
