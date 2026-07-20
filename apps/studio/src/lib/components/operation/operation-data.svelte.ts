import { getContext, setContext } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'svelte-sonner';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { PUBLIC_API_URL } from '$env/static/public';
import {
	ADMIN_NAMESPACE,
	AdminEvents,
	DeviceStatusSchema,
	SessionLogEntrySchema,
	SessionStateSchema,
	type Asset,
	type Session,
	type SessionLogEntry,
	type SessionState,
	type SessionStateValue
} from '@roomkit/shared';
import { listAssets } from '$lib/api/assets';
import { listLogs } from '$lib/api/logs';
import { listSessions } from '$lib/api/sessions';
import { auth } from '$lib/stores/auth.svelte';
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
	startedAt: Date;
	live: LiveSnapshot | null;
}

const LOG_BUFFER_LIMIT = 1000;

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
	/** `${sessionId}:${deviceId}` → online */
	readonly deviceStatus = new SvelteMap<string, boolean>();

	selectedSessionId = $state<string | null>(null);
	logs = $state<SessionLogEntry[]>([]);
	logsLoading = $state(false);

	#requestId = 0;
	#logsRequestId = 0;
	#socket: Socket;

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
		for (const key of this.deviceStatus.keys()) {
			if (key.startsWith(`${sessionId}:`)) this.deviceStatus.delete(key);
		}
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
		this.#socket.disconnect();
	}

	// ── socket ───────────────────────────────────────────────────────────────

	#wireSocket(): void {
		this.#socket.on('connect', () => {
			this.connected = true;
			// The server re-dumps current session states and online devices right
			// after connect — stale flags must not survive a reconnect.
			this.live.clear();
			this.deviceStatus.clear();
			if (this.selectedSessionId) {
				const lastId = this.logs.at(-1)?.id;
				void this.loadLogs(this.selectedSessionId, lastId);
			}
		});
		this.#socket.on('disconnect', () => {
			this.connected = false;
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
		this.#socket.on(AdminEvents.deviceStatus, (payload: unknown) => {
			const parsed = DeviceStatusSchema.safeParse(payload);
			if (!parsed.success) return;
			const { sessionId, deviceId, online } = parsed.data;
			this.deviceStatus.set(`${sessionId}:${deviceId}`, online);
		});
		this.#socket.on(AdminEvents.log, (payload: unknown) => {
			const parsed = SessionLogEntrySchema.safeParse(payload);
			if (!parsed.success) return;
			if (parsed.data.sessionId !== this.selectedSessionId) return;
			this.appendLogs([parsed.data]);
		});
	}

	// ── helpers ──────────────────────────────────────────────────────────────

	isDeviceOnline(sessionId: string, deviceId: string): boolean {
		return this.deviceStatus.get(`${sessionId}:${deviceId}`) ?? false;
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
