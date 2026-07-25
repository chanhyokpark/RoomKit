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
	PlayerStatusSchema,
	WebsiteTestActivitySchema,
	WebsiteTestRunSchema,
	type Asset,
	type Command,
	type PlayerStatus,
	type WebsiteTestActivity,
	type WebsiteTestRun,
	type WebsiteTestTimerInput
} from '@roomkit/shared';
import { listAssets } from '$lib/api/assets';
import { toastApiError } from '$lib/api/client';
import {
	cancelWebsiteTestRun,
	createWebsiteTest,
	getWebsiteTestActivity,
	listWebsiteTests,
	reloadWebsiteTest,
	runWebsiteTestEvent,
	sendWebsiteTestCommand,
	setWebsiteTestTimer,
	stopWebsiteTest,
	updateWebsiteTest
} from '$lib/api/website-test';
import { auth } from '$lib/stores/auth.svelte';
import type { EventAsset, PhaseAsset } from '$lib/components/editor/editor-data.svelte';
import type { DeviceAsset } from '$lib/components/operation/operation-data.svelte';

export type WebsiteAsset = Extract<Asset, { kind: 'website' }>;

const ACTIVITY_BUFFER_LIMIT = 500;

interface SetupMemory {
	playerId?: string;
	deviceId?: string;
	url?: string;
}

/**
 * Website-test page state: theme assets, connected players, the theme's
 * active run (server truth via /admin broadcasts, rehydrated over REST after
 * a reload), and the run's activity feed. Nothing here is persisted server-
 * side — a server restart simply drops the run.
 */
export class WebsiteTestData {
	readonly themeId: string;

	assets = $state<Asset[]>([]);
	loading = $state(true);
	connected = $state(false);

	/** playerId → connected player launcher (global, not per theme). */
	readonly playersById = new SvelteMap<string, PlayerStatus>();

	run = $state<WebsiteTestRun | null>(null);
	/** Local receipt time of the run snapshot — baseline for timer ticking. */
	runReceivedAt = $state(0);
	activity = $state<WebsiteTestActivity[]>([]);
	/** The one in-flight event run (server enforces one at a time). */
	runningEvent = $state<{ eventRunId: string; eventId: string; eventName: string } | null>(null);

	#requestId = 0;
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
	websites = $derived(this.assets.filter((asset) => asset.kind === 'website') as WebsiteAsset[]);
	players = $derived(
		[...this.playersById.values()].toSorted((a, b) => a.playerName.localeCompare(b.playerName))
	);

	constructor(themeId: string) {
		this.themeId = themeId;
		void this.refresh();
		this.#socket = io(`${PUBLIC_API_URL}${ADMIN_NAMESPACE}`, {
			auth: { token: auth.token ?? '' }
		});
		this.#wireSocket();
	}

	dispose(): void {
		this.#socket.disconnect();
	}

	// ── loading ──────────────────────────────────────────────────────────────

	async refresh(): Promise<void> {
		const rid = ++this.#requestId;
		try {
			const [assets, runs] = await Promise.all([
				listAssets(this.themeId),
				listWebsiteTests(this.themeId)
			]);
			if (rid !== this.#requestId) return;
			this.assets = assets;
			// A page reload mid-test rehydrates the newest active run + its feed.
			const newest = runs.toSorted((a, b) => b.createdAt - a.createdAt)[0] ?? null;
			if (newest && newest.runId !== this.run?.runId) {
				this.#adoptRun(newest);
				void this.#loadActivity(newest.runId);
			} else if (!newest) {
				this.run = null;
				this.runningEvent = null;
			}
		} catch {
			if (rid === this.#requestId) toast.error('웹 테스트 데이터를 불러오지 못했습니다.');
		} finally {
			if (rid === this.#requestId) this.loading = false;
		}
	}

	async #loadActivity(runId: string): Promise<void> {
		try {
			const entries = await getWebsiteTestActivity(runId);
			if (this.run?.runId !== runId) return;
			this.activity = entries.slice(-ACTIVITY_BUFFER_LIMIT);
			this.#deriveRunningEvent();
		} catch {
			// Feed backfill is best-effort; live entries still stream in.
		}
	}

	// ── actions ──────────────────────────────────────────────────────────────

	async start(input: { playerId: string; deviceId: string; url: string }): Promise<boolean> {
		try {
			// One visible run per theme keeps the page unambiguous — starting a new
			// test replaces the current one.
			if (this.run) await stopWebsiteTest(this.run.runId).catch(() => {});
			const run = await createWebsiteTest({ themeId: this.themeId, ...input });
			this.#adoptRun(run);
			this.activity = [];
			this.runningEvent = null;
			this.saveSetup(input);
			return true;
		} catch (err) {
			toastApiError(err, '웹 테스트를 시작하지 못했습니다.');
			return false;
		}
	}

	async stop(): Promise<void> {
		if (!this.run) return;
		try {
			await stopWebsiteTest(this.run.runId);
			this.run = null;
			this.runningEvent = null;
		} catch (err) {
			toastApiError(err, '웹 테스트를 종료하지 못했습니다.');
		}
	}

	async sendCommand(command: Command): Promise<void> {
		if (!this.run) return;
		try {
			await sendWebsiteTestCommand(this.run.runId, command);
		} catch (err) {
			toastApiError(err, '커맨드 실행에 실패했습니다.');
		}
	}

	async runEvent(eventId: string): Promise<void> {
		if (!this.run) return;
		try {
			await runWebsiteTestEvent(this.run.runId, eventId);
		} catch (err) {
			toastApiError(err, '이벤트 실행에 실패했습니다.');
		}
	}

	async cancelEventRun(): Promise<void> {
		if (!this.run) return;
		try {
			await cancelWebsiteTestRun(this.run.runId);
		} catch (err) {
			toastApiError(err, '이벤트 중단에 실패했습니다.');
		}
	}

	async reload(): Promise<void> {
		if (!this.run) return;
		try {
			await reloadWebsiteTest(this.run.runId);
		} catch (err) {
			toastApiError(err, '사이트 새로고침에 실패했습니다.');
		}
	}

	async setTimer(input: WebsiteTestTimerInput): Promise<void> {
		if (!this.run) return;
		try {
			this.#adoptRun(await setWebsiteTestTimer(this.run.runId, input));
		} catch (err) {
			toastApiError(err, '타이머 조정에 실패했습니다.');
		}
	}

	async setUrl(url: string): Promise<void> {
		if (!this.run) return;
		try {
			this.#adoptRun(await updateWebsiteTest(this.run.runId, { url }));
		} catch (err) {
			toastApiError(err, 'URL 변경에 실패했습니다.');
		}
	}

	async setPhase(phaseId: string | null): Promise<void> {
		if (!this.run) return;
		try {
			this.#adoptRun(await updateWebsiteTest(this.run.runId, { phaseId }));
		} catch (err) {
			toastApiError(err, '페이즈 변경에 실패했습니다.');
		}
	}

	// ── setup memory ─────────────────────────────────────────────────────────

	loadSetup(): SetupMemory {
		try {
			const parsed: unknown = JSON.parse(
				localStorage.getItem(`roomkit:website-test:${this.themeId}`) ?? ''
			);
			if (parsed === null || typeof parsed !== 'object') return {};
			const memory = parsed as Record<string, unknown>;
			return {
				playerId: typeof memory.playerId === 'string' ? memory.playerId : undefined,
				deviceId: typeof memory.deviceId === 'string' ? memory.deviceId : undefined,
				url: typeof memory.url === 'string' ? memory.url : undefined
			};
		} catch {
			return {};
		}
	}

	saveSetup(memory: SetupMemory): void {
		try {
			localStorage.setItem(`roomkit:website-test:${this.themeId}`, JSON.stringify(memory));
		} catch {
			// Storage full or unavailable — memory is best-effort.
		}
	}

	// ── socket ───────────────────────────────────────────────────────────────

	#wireSocket(): void {
		this.#socket.on('connect', () => {
			this.connected = true;
			// The server re-dumps player status right after connect; the active run
			// is broadcast-only state and must be re-fetched.
			this.playersById.clear();
			void this.refresh();
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
		this.#socket.on(AdminEvents.playerStatus, (payload: unknown) => {
			const parsed = PlayerStatusSchema.safeParse(payload);
			if (!parsed.success) return;
			if (parsed.data.online) {
				this.playersById.set(parsed.data.playerId, parsed.data);
			} else {
				this.playersById.delete(parsed.data.playerId);
			}
		});
		this.#socket.on(AdminEvents.websiteTestState, (payload: unknown) => {
			const parsed = WebsiteTestRunSchema.safeParse(payload);
			if (!parsed.success || parsed.data.themeId !== this.themeId) return;
			const incoming = parsed.data;
			if (incoming.active) {
				const isNew = incoming.runId !== this.run?.runId;
				this.#adoptRun(incoming);
				if (isNew) {
					this.activity = [];
					this.runningEvent = null;
					void this.#loadActivity(incoming.runId);
				}
			} else if (incoming.runId === this.run?.runId) {
				this.run = null;
				this.runningEvent = null;
			}
		});
		this.#socket.on(AdminEvents.websiteTestActivity, (payload: unknown) => {
			const parsed = WebsiteTestActivitySchema.safeParse(payload);
			if (!parsed.success || parsed.data.runId !== this.run?.runId) return;
			const merged = [...this.activity, parsed.data];
			this.activity =
				merged.length > ACTIVITY_BUFFER_LIMIT ? merged.slice(-ACTIVITY_BUFFER_LIMIT) : merged;
			this.#applyEventRunEntry(parsed.data);
		});
	}

	// ── helpers ──────────────────────────────────────────────────────────────

	assetName(id: string | null): string | null {
		return id === null ? null : (this.byId.get(id)?.name ?? null);
	}

	#adoptRun(run: WebsiteTestRun): void {
		this.run = run;
		this.runReceivedAt = Date.now();
	}

	#applyEventRunEntry(entry: WebsiteTestActivity): void {
		if (entry.kind !== 'eventRun') return;
		if (entry.status === 'started') {
			this.runningEvent = {
				eventRunId: entry.eventRunId,
				eventId: entry.eventId,
				eventName: entry.eventName
			};
		} else if (this.runningEvent?.eventRunId === entry.eventRunId) {
			this.runningEvent = null;
		}
	}

	/** Rebuild the running-event flag from a backfilled feed. */
	#deriveRunningEvent(): void {
		this.runningEvent = null;
		for (const entry of this.activity) this.#applyEventRunEntry(entry);
	}
}

/** `localhost:5173` → `http://localhost:5173` (the server requires a scheme). */
export function normalizeUrl(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
	return `http://${trimmed}`;
}

const WEBSITE_TEST_DATA_KEY = Symbol('website-test-data');

export function provideWebsiteTestData(themeId: string): WebsiteTestData {
	return setContext(WEBSITE_TEST_DATA_KEY, new WebsiteTestData(themeId));
}

export function useWebsiteTestData(): WebsiteTestData {
	return getContext<WebsiteTestData>(WEBSITE_TEST_DATA_KEY);
}
