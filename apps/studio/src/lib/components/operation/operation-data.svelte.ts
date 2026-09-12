import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { PUBLIC_API_URL } from '$env/static/public';
import {
	ADMIN_NAMESPACE,
	AdminCallStateSchema,
	AdminEvents,
	CallActionAckSchema,
	DeviceLogBatchSchema,
	DeviceScreenshotSchema,
	DeviceStatusSchema,
	PlayerStatusSchema,
	SessionLogEntrySchema,
	SessionMediaSchema,
	SessionNotificationSchema,
	SessionRunsSchema,
	SessionStateSchema,
	type Asset,
	type CallEndReason,
	type CallErrorReason,
	type CallInfo,
	type DeviceLogLine,
	type DeviceScreenshot,
	type DeviceStatus,
	type PlayerStatus,
	type RunningEvent,
	type Session,
	type SessionLogEntry,
	type SessionMedia,
	type SessionNotification,
	type SessionState,
	type SessionStateValue,
	type Verdict
} from '@roomkit/shared';
import { listAssets } from '$lib/api/assets';
import { listLogs } from '$lib/api/logs';
import { listSessions } from '$lib/api/sessions';
import { auth } from '$lib/stores/auth.svelte';
import { versionWarning } from '$lib/version';
import { CallController } from './call-controller';
import type { EventAsset, PhaseAsset } from '$lib/components/editor/editor-data.svelte';

export type DeviceAsset = Extract<Asset, { kind: 'device' }>;
export type HintAsset = Extract<Asset, { kind: 'hint' }>;

/** Live socket snapshot plus its local receipt time (baseline for timer ticking). */
export interface LiveSnapshot {
	state: SessionState;
	at: number;
}

/** A dashboard row: the REST row overlaid with the freshest live snapshot. */
export interface SessionView {
	id: string;
	mode: 'test' | 'production';
	state: SessionStateValue;
	phaseId: string | null;
	verdict: Verdict | null;
	startedAt: Date;
	live: LiveSnapshot | null;
}

const LOG_BUFFER_LIMIT = 1000;
/** Socket acks for call actions are immediate; this only covers a dead link. */
const CALL_ACK_TIMEOUT_MS = 10_000;

const CALL_ERROR_LABELS: Record<CallErrorReason | 'mic_denied' | 'peer_error', string> = {
	test_session: '테스트 세션에서는 통화를 사용할 수 없습니다.',
	session_not_live: '진행 중인 세션이 아닙니다.',
	no_helper: '이 장치의 웹사이트가 Helper를 사용하지 않아 통화할 수 없습니다.',
	device_outdated: '장치의 Player를 업데이트해야 통화할 수 있습니다.',
	device_offline: '장치가 오프라인입니다.',
	busy: '이미 진행 중인 통화가 있습니다.',
	no_call: '통화 요청이 더 이상 유효하지 않습니다.',
	not_owner: '다른 운영자가 시작한 통화입니다.',
	invalid: '잘못된 요청입니다.',
	mic_denied: '마이크 권한이 필요합니다.',
	peer_error: '통화 서버에 연결하지 못했습니다.'
};

const CALL_END_LABELS: Partial<Record<CallEndReason, string>> = {
	cancelled: '장치가 통화 요청을 취소했습니다.',
	device_offline: '장치 연결이 끊겨 통화가 종료되었습니다.',
	device_failed: '장치에서 통화 연결에 실패했습니다.',
	session_ended: '세션이 종료되어 통화가 끝났습니다.',
	timeout: '장치가 응답하지 않아 통화가 종료되었습니다.',
	admin_disconnected: '운영자 연결이 끊겨 통화가 종료되었습니다.'
};

/**
 * Operation page state: theme assets for name resolution and controls, the
 * session list (REST truth overlaid with live /admin broadcasts), per-session
 * device online status, and the selected session's log stream.
 */
export class OperationData {
	readonly themeId: string;

	assets = $state<Asset[]>([]);
	loading = $state(true);
	connected = $state(false);

	restSessions = $state<Session[]>([]);
	readonly live = new SvelteMap<string, LiveSnapshot>();
	/** `${sessionId}:${deviceId}` → latest device:status (online + versions). */
	readonly deviceStatus = new SvelteMap<string, DeviceStatus>();
	/** `${sessionId}:${deviceId}` → latest stage capture (server keeps one per device). */
	readonly deviceScreenshot = new SvelteMap<string, DeviceScreenshot>();
	/** `${sessionId}:${deviceId}` → player log lines received live (capped). */
	readonly deviceLogs = new SvelteMap<string, DeviceLogLine[]>();
	/** sessionId → in-flight event runs (server sends full snapshots). */
	readonly runs = new SvelteMap<string, RunningEvent[]>();
	/** sessionId → playing media/websites (server sends full snapshots). */
	readonly media = new SvelteMap<string, SessionMedia>();
	/** sessionId → newest operator notifications, capped per session. */
	readonly notifications = new SvelteMap<string, SessionNotification[]>();
	/** playerId → connected player launcher (global, not per theme). */
	readonly playersById = new SvelteMap<string, PlayerStatus>();
	/** sessionId → the session's voice call (server keeps one per session). */
	readonly calls = new SvelteMap<string, CallInfo>();
	/** Our /admin socket id — a call whose `adminSocketId` matches is ours to end. */
	socketId = $state<string | null>(null);

	selectedSessionId = $state<string | null>(null);
	logs = $state<SessionLogEntry[]>([]);
	logsLoading = $state(false);

	#requestId = 0;
	#logsRequestId = 0;
	#socket: Socket;
	/** The one call this tab is in (mic + peer); session id it belongs to. */
	#call: { controller: CallController; sessionId: string } | null = null;

	// Rebuilt wholesale by $derived and never mutated, so a plain Map is fine.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	byId = $derived(new Map(this.assets.map((asset) => [asset.id, asset])));
	phases = $derived(
		(this.assets.filter((asset) => asset.kind === 'phase') as PhaseAsset[]).toSorted(
			(a, b) => a.data.order - b.data.order || a.name.localeCompare(b.name)
		)
	);
	events = $derived(this.assets.filter((asset) => asset.kind === 'event') as EventAsset[]);
	devices = $derived(this.assets.filter((asset) => asset.kind === 'device') as DeviceAsset[]);
	hints = $derived(this.assets.filter((asset) => asset.kind === 'hint') as HintAsset[]);

	/** REST rows overlaid with live snapshots; production first, then newest. */
	sessions = $derived.by<SessionView[]>(() => {
		const views = this.restSessions.map((row) => this.toView(row));
		// A session created elsewhere can be live before the REST list refreshes.
		for (const [sessionId, snapshot] of this.live) {
			if (snapshot.state.themeId !== this.themeId) continue;
			if (views.some((v) => v.id === sessionId)) continue;
			views.push({
				id: sessionId,
				mode: snapshot.state.mode,
				state: snapshot.state.state,
				phaseId: snapshot.state.phaseId,
				verdict: snapshot.state.verdict,
				// Rebuilt wholesale by $derived and never mutated.
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				startedAt: new Date(snapshot.at),
				live: snapshot
			});
		}
		return views.toSorted(
			(a, b) =>
				(a.mode === 'production' ? 0 : 1) - (b.mode === 'production' ? 0 : 1) ||
				b.startedAt.getTime() - a.startedAt.getTime()
		);
	});

	selected = $derived(this.sessions.find((s) => s.id === this.selectedSessionId) ?? null);

	hasLiveProduction = $derived(
		this.sessions.some((s) => s.mode === 'production' && s.state !== 'ended')
	);

	players = $derived(
		[...this.playersById.values()].toSorted((a, b) => a.playerName.localeCompare(b.playerName))
	);

	/**
	 * Outdated-component warnings: connected players below the expected player
	 * version, and this theme's online devices whose client/helper versions
	 * fall below expectations. Absent version info (old server) never warns.
	 */
	versionWarnings = $derived.by<string[]>(() => {
		const warnings: string[] = [];
		for (const player of this.players) {
			const warning = versionWarning('player', player.version, `플레이어 "${player.playerName}"`);
			if (warning) warnings.push(warning);
		}
		for (const status of this.deviceStatus.values()) {
			if (!status.online || !this.#sessionInTheme(status.sessionId)) continue;
			const subject = `장치 "${status.deviceName || status.deviceId}"`;
			const client = versionWarning('client', status.clientVersion, subject);
			if (client) warnings.push(client);
			const helper = versionWarning('helper', status.helperVersion, subject);
			if (helper) warnings.push(helper);
		}
		return [...new Set(warnings)];
	});

	constructor(themeId: string) {
		this.themeId = themeId;
		void this.refresh();
		this.#socket = io(`${PUBLIC_API_URL}${ADMIN_NAMESPACE}`, {
			auth: { token: auth.token ?? '' }
		});
		this.#wireSocket();
	}

	// ── loading ──────────────────────────────────────────────────────────────

	async refresh(): Promise<void> {
		const rid = ++this.#requestId;
		try {
			const [assets, sessions] = await Promise.all([
				listAssets(this.themeId),
				listSessions({ themeId: this.themeId })
			]);
			if (rid !== this.#requestId) return;
			this.assets = assets;
			this.restSessions = sessions;
		} catch {
			if (rid === this.#requestId) toast.error('운영 데이터를 불러오지 못했습니다.');
		} finally {
			if (rid === this.#requestId) this.loading = false;
		}
	}

	async refreshSessions(): Promise<void> {
		try {
			this.restSessions = await listSessions({ themeId: this.themeId });
		} catch {
			toast.error('세션 목록을 불러오지 못했습니다.');
		}
	}

	/** Drops local traces of a deleted session, then refreshes the REST list. */
	async forgetSession(sessionId: string): Promise<void> {
		this.live.delete(sessionId);
		this.runs.delete(sessionId);
		this.media.delete(sessionId);
		this.notifications.delete(sessionId);
		for (const key of this.deviceStatus.keys()) {
			if (key.startsWith(`${sessionId}:`)) this.deviceStatus.delete(key);
		}
		for (const key of this.deviceScreenshot.keys()) {
			if (key.startsWith(`${sessionId}:`)) this.deviceScreenshot.delete(key);
		}
		for (const key of this.deviceLogs.keys()) {
			if (key.startsWith(`${sessionId}:`)) this.deviceLogs.delete(key);
		}
		this.calls.delete(sessionId);
		if (this.selectedSessionId === sessionId) this.select(null);
		await this.refreshSessions();
	}

	select(sessionId: string | null): void {
		if (this.selectedSessionId === sessionId) return;
		this.selectedSessionId = sessionId;
		this.logs = [];
		if (sessionId) void this.loadLogs(sessionId);
	}

	/** Page forward from `afterId` until a short page; keeps the buffer capped. */
	async loadLogs(sessionId: string, afterId?: number): Promise<void> {
		const rid = ++this.#logsRequestId;
		this.logsLoading = this.logs.length === 0;
		try {
			let cursor = afterId;
			for (;;) {
				const page = await listLogs(sessionId, { afterId: cursor, limit: 500 });
				if (rid !== this.#logsRequestId || this.selectedSessionId !== sessionId) return;
				this.appendLogs(page);
				if (page.length < 500) break;
				cursor = page[page.length - 1].id;
			}
		} catch {
			if (rid === this.#logsRequestId) toast.error('로그를 불러오지 못했습니다.');
		} finally {
			if (rid === this.#logsRequestId) this.logsLoading = false;
		}
	}

	dispose(): void {
		this.#closeCall();
		this.#socket.disconnect();
	}

	// ── voice calls ──────────────────────────────────────────────────────────

	callFor(sessionId: string): CallInfo | null {
		return this.calls.get(sessionId) ?? null;
	}

	ownsCall(call: CallInfo): boolean {
		return this.socketId !== null && call.adminSocketId === this.socketId;
	}

	/** Start a call to a device: mic + peer first, then ask the server. */
	startCall(sessionId: string, deviceId: string): Promise<void> {
		return this.#openCall(sessionId, (peerId) =>
			this.#callAck(AdminEvents.callStart, { sessionId, deviceId, peerId })
		);
	}

	acceptCall(sessionId: string, callId: string): Promise<void> {
		return this.#openCall(sessionId, (peerId) =>
			this.#callAck(AdminEvents.callAccept, { sessionId, callId, peerId })
		);
	}

	async declineCall(sessionId: string, callId: string): Promise<void> {
		await this.#callAck(AdminEvents.callDecline, { sessionId, callId });
	}

	async endCall(sessionId: string): Promise<void> {
		await this.#callAck(AdminEvents.callEnd, { sessionId });
		this.#closeCall();
	}

	async #openCall(sessionId: string, ask: (peerId: string) => Promise<CallInfo>): Promise<void> {
		if (this.#call) throw new Error(CALL_ERROR_LABELS.busy);
		const controller = new CallController(this.#socket, PUBLIC_API_URL);
		this.#call = { controller, sessionId };
		try {
			const peerId = await controller.open();
			const call = await ask(peerId);
			controller.expect(call.devicePeerId);
		} catch (error) {
			if (this.#call?.controller === controller) this.#call = null;
			controller.close();
			const key = error instanceof Error ? error.message : '';
			throw new Error(
				key in CALL_ERROR_LABELS
					? CALL_ERROR_LABELS[key as keyof typeof CALL_ERROR_LABELS]
					: key || '통화를 시작하지 못했습니다.',
				{ cause: error }
			);
		}
	}

	async #callAck(event: string, payload: unknown): Promise<CallInfo> {
		let raw: unknown;
		try {
			raw = await this.#socket.timeout(CALL_ACK_TIMEOUT_MS).emitWithAck(event, payload);
		} catch {
			throw new Error('서버가 응답하지 않습니다.');
		}
		const parsed = CallActionAckSchema.safeParse(raw);
		if (!parsed.success) throw new Error(CALL_ERROR_LABELS.invalid);
		if (!parsed.data.ok) throw new Error(parsed.data.reason);
		return parsed.data.call;
	}

	#closeCall(): void {
		this.#call?.controller.close();
		this.#call = null;
	}

	// ── socket ───────────────────────────────────────────────────────────────

	#wireSocket(): void {
		this.#socket.on('connect', () => {
			this.connected = true;
			this.socketId = this.#socket.id ?? null;
			this.calls.clear();
			// The server re-dumps current session states and online devices right
			// after connect — stale flags must not survive a reconnect.
			this.live.clear();
			this.deviceStatus.clear();
			this.deviceScreenshot.clear();
			this.deviceLogs.clear();
			this.runs.clear();
			this.media.clear();
			this.playersById.clear();
			// The dump only covers live sessions; sessions created or ended while
			// disconnected only show up in a fresh REST list.
			void this.refreshSessions();
			if (this.selectedSessionId) {
				const lastId = this.logs.at(-1)?.id;
				void this.loadLogs(this.selectedSessionId, lastId);
			}
		});
		this.#socket.on('disconnect', () => {
			this.connected = false;
			this.socketId = null;
			// The server ends our call on this disconnect; drop the mic now.
			this.#closeCall();
		});
		this.#socket.on('connect_error', (err: Error) => {
			if (err.message === 'unauthorized') {
				this.#socket.disconnect();
				auth.logout();
				void goto(resolve('/login'));
			}
		});
		this.#socket.on(AdminEvents.sessionState, (payload: unknown) => {
			const parsed = SessionStateSchema.safeParse(payload);
			if (!parsed.success) return;
			this.live.set(parsed.data.sessionId, { state: parsed.data, at: Date.now() });
		});
		this.#socket.on(AdminEvents.sessionRuns, (payload: unknown) => {
			const parsed = SessionRunsSchema.safeParse(payload);
			if (!parsed.success) return;
			this.runs.set(parsed.data.sessionId, parsed.data.runs);
		});
		this.#socket.on(AdminEvents.sessionMedia, (payload: unknown) => {
			const parsed = SessionMediaSchema.safeParse(payload);
			if (!parsed.success) return;
			this.media.set(parsed.data.sessionId, parsed.data);
		});
		this.#socket.on(AdminEvents.deviceStatus, (payload: unknown) => {
			const parsed = DeviceStatusSchema.safeParse(payload);
			if (!parsed.success) return;
			const { sessionId, deviceId, deviceName, online } = parsed.data;
			this.deviceStatus.set(`${sessionId}:${deviceId}`, parsed.data);
			// The server only emits offline on a real drop; an ended session
			// disconnects every device on purpose, so that flood stays silent.
			if (
				!online &&
				this.#sessionInTheme(sessionId) &&
				this.live.get(sessionId)?.state.state !== 'ended'
			) {
				toast.warning(`장치 "${deviceName}" 연결이 끊어졌습니다.`);
			}
		});
		this.#socket.on(AdminEvents.deviceScreenshot, (payload: unknown) => {
			const parsed = DeviceScreenshotSchema.safeParse(payload);
			if (!parsed.success) return;
			const { sessionId, deviceId } = parsed.data;
			this.deviceScreenshot.set(`${sessionId}:${deviceId}`, parsed.data);
		});
		this.#socket.on(AdminEvents.deviceLogs, (payload: unknown) => {
			const parsed = DeviceLogBatchSchema.safeParse(payload);
			if (!parsed.success) return;
			const { sessionId, deviceId, lines } = parsed.data;
			const key = `${sessionId}:${deviceId}`;
			this.deviceLogs.set(key, [...(this.deviceLogs.get(key) ?? []), ...lines].slice(-1000));
		});
		this.#socket.on(AdminEvents.callState, (payload: unknown) => {
			const parsed = AdminCallStateSchema.safeParse(payload);
			if (!parsed.success) return;
			const { sessionId, call, endReason, endDetail } = parsed.data;
			const previous = this.calls.get(sessionId) ?? null;
			if (call) this.calls.set(sessionId, call);
			else this.calls.delete(sessionId);
			if (!this.#sessionInTheme(sessionId)) return;
			if (call?.status === 'requested' && previous?.callId !== call.callId) {
				toast.info(`장치 "${call.deviceName}"에서 통화를 요청했습니다.`, { duration: 15_000 });
			}
			// Our call went away (device/session/timeout) or was taken over.
			if (this.#call?.sessionId === sessionId) {
				const mine = call !== null && this.ownsCall(call);
				if (!mine) {
					this.#closeCall();
					const label = endReason && CALL_END_LABELS[endReason];
					// The device's own failure detail (mic_denied, peer_error:…) is
					// the only clue an operator gets — keep it visible.
					if (label) toast.warning(endDetail ? `${label} (${endDetail})` : label);
				}
			}
		});
		this.#socket.on(AdminEvents.notification, (payload: unknown) => {
			const parsed = SessionNotificationSchema.safeParse(payload);
			if (!parsed.success) return;
			if (!this.#sessionInTheme(parsed.data.sessionId)) return;
			const previous = this.notifications.get(parsed.data.sessionId) ?? [];
			this.notifications.set(parsed.data.sessionId, [parsed.data, ...previous].slice(0, 5));
			toast.info(parsed.data.message, { duration: 10_000 });
		});
		this.#socket.on(AdminEvents.playerStatus, (payload: unknown) => {
			const parsed = PlayerStatusSchema.safeParse(payload);
			if (!parsed.success) return;
			if (parsed.data.online) {
				this.playersById.set(parsed.data.playerId, parsed.data);
			} else {
				this.playersById.delete(parsed.data.playerId);
			}
		});
		this.#socket.on(AdminEvents.log, (payload: unknown) => {
			const parsed = SessionLogEntrySchema.safeParse(payload);
			if (!parsed.success) return;
			if (parsed.data.sessionId !== this.selectedSessionId) return;
			this.appendLogs([parsed.data]);
		});
	}

	// ── helpers ──────────────────────────────────────────────────────────────

	/** Socket events are global; only this theme's sessions may toast. */
	#sessionInTheme(sessionId: string): boolean {
		const snapshot = this.live.get(sessionId);
		if (snapshot) return snapshot.state.themeId === this.themeId;
		return this.restSessions.some((row) => row.id === sessionId);
	}

	screenshotFor(sessionId: string, deviceId: string): DeviceScreenshot | null {
		return this.deviceScreenshot.get(`${sessionId}:${deviceId}`) ?? null;
	}

	deviceLogsFor(sessionId: string, deviceId: string): DeviceLogLine[] {
		return this.deviceLogs.get(`${sessionId}:${deviceId}`) ?? [];
	}

	isDeviceOnline(sessionId: string, deviceId: string): boolean {
		return this.deviceStatus.get(`${sessionId}:${deviceId}`)?.online ?? false;
	}

	runsFor(sessionId: string): RunningEvent[] {
		return this.runs.get(sessionId) ?? [];
	}

	mediaFor(sessionId: string): SessionMedia {
		return this.media.get(sessionId) ?? { sessionId, playing: [], websites: [], states: [] };
	}

	notificationsFor(sessionId: string): SessionNotification[] {
		return this.notifications.get(sessionId) ?? [];
	}

	assetName(id: string | null): string | null {
		return id === null ? null : (this.byId.get(id)?.name ?? null);
	}

	/** Dedupes against the buffer (socket vs catch-up fetch overlap) and caps it. */
	private appendLogs(entries: SessionLogEntry[]): void {
		const lastId = this.logs.at(-1)?.id ?? 0;
		const fresh = entries.filter((e) => e.id > lastId);
		if (fresh.length === 0) return;
		const merged = [...this.logs, ...fresh];
		this.logs = merged.length > LOG_BUFFER_LIMIT ? merged.slice(-LOG_BUFFER_LIMIT) : merged;
	}

	private toView(row: Session): SessionView {
		const live = this.live.get(row.id) ?? null;
		return {
			id: row.id,
			mode: row.mode,
			state: live?.state.state ?? row.state,
			phaseId: live ? live.state.phaseId : row.phaseId,
			verdict: live ? live.state.verdict : row.verdict,
			startedAt: row.startedAt,
			live
		};
	}
}

const OPERATION_DATA_KEY = Symbol('operation-data');

export function provideOperationData(themeId: string): OperationData {
	return setContext(OPERATION_DATA_KEY, new OperationData(themeId));
}

export function useOperationData(): OperationData {
	return getContext<OperationData>(OPERATION_DATA_KEY);
}
