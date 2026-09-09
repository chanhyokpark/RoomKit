import type {
	AdjustTimerInput,
	Asset,
	CallInfo,
	Command,
	DeviceScreenshot,
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
export type StateAsset = Extract<Asset, { kind: 'state' }>;

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
	/** Newest first. */
	readonly notifications: SessionNotification[];
	readonly testDeviceCodes: TestDeviceCode[];
	statusOf(deviceId: string): DeviceStatus | null;
	/** Latest stage capture reported by the device's player window, if any. */
	screenshotOf(deviceId: string): DeviceScreenshot | null;
	/** The session's voice call (one at a time); absent = host without call support. */
	readonly call?: CallInfo | null;
	/** True when this host's admin socket owns the active call (may end it). */
	readonly ownsCall?: boolean;
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
	/** Skip the current entry (e.g. a `wait`) of an in-flight run. */
	skipRun(runId: string): Promise<void>;
	resetDevices(): Promise<void>;
	runCommand(command: Command): Promise<void>;
	pushHint(input: PushHintInput): Promise<void>;
	runTestCallback(deviceId: string, name: string): Promise<{ ok: boolean }>;
	getSummary(): Promise<SessionSummary>;
	/** Voice calls — absent on hosts without call support (player debug window). */
	startCall?(deviceId: string): Promise<void>;
	acceptCall?(callId: string): Promise<void>;
	declineCall?(callId: string): Promise<void>;
	endCall?(): Promise<void>;
}
