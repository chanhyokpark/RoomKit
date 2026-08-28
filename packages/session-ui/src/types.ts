import type {
	AdjustTimerInput,
	Asset,
	Command,
	DeviceStatus,
	PushHintInput,
	RunningEvent,
	SessionLogEntry,
	SessionMedia,
	SessionNotification,
	SessionState,
	SessionSummary,
	TestDeviceCode
} from '@roomkit/shared';

export type DeviceAsset = Extract<Asset, { kind: 'device' }>;
export type EventAsset = Extract<Asset, { kind: 'event' }>;
export type HintAsset = Extract<Asset, { kind: 'hint' }>;
export type MessageAsset = Extract<Asset, { kind: 'message' }>;
export type PhaseAsset = Extract<Asset, { kind: 'phase' }>;

/**
 * Reactive read model consumed by the shared session dashboard. Implementations
 * may expose Svelte getters over an app store; consumers never mutate it.
 */
export interface SessionUiModel {
	readonly sessionId: string;
	readonly session: SessionState | null;
	/** Epoch ms when `session` was received, used for local timer ticking. */
	readonly sessionReceivedAt: number;
	readonly connected: boolean;
	readonly assets: Asset[];
	readonly runs: RunningEvent[];
	readonly media: SessionMedia | null;
	/** Oldest first. */
	readonly logs: SessionLogEntry[];
	readonly logsLoading: boolean;
	readonly notifications: SessionNotification[];
	readonly testDeviceCodes: TestDeviceCode[];
	statusOf(deviceId: string): DeviceStatus | null;
}

/** All mutations/fetches used by the dashboard, supplied by Studio or Player. */
export interface SessionUiActions {
	start(resetFirst: boolean): Promise<void>;
	pause(): Promise<void>;
	resume(): Promise<void>;
	end(): Promise<void>;
	adjustTimer(input: AdjustTimerInput): Promise<void>;
	switchPhase(phaseId: string): Promise<void>;
	restartPhase(): Promise<void>;
	triggerEvent(eventId: string): Promise<void>;
	abortRun(runId: string): Promise<void>;
	resetDevices(): Promise<void>;
	runCommand(command: Command): Promise<void>;
	pushHint(input: PushHintInput): Promise<void>;
	runTestCallback(deviceId: string, name: string): Promise<{ ok: boolean }>;
	getSummary(): Promise<SessionSummary>;
}
