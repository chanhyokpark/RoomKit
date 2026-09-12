<script lang="ts">
	import {
		SessionDashboard,
		type SessionUiActions,
		type SessionUiModel
	} from '@roomkit/session-ui';
	import type { SessionState, TestDeviceCode } from '@roomkit/shared';
	import {
		abortRun,
		adjustTimer,
		endSession,
		getDeviceLogs,
		getSession,
		getSessionSummary,
		pauseSession,
		pushHint,
		resetDevices,
		restartPhase,
		resumeSession,
		runSessionCommand,
		runTestCallback,
		skipRun,
		startSession,
		switchPhase,
		triggerEvent
	} from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';

	let { session, singleColumn = false }: { session: SessionView; singleColumn?: boolean } =
		$props();
	const data = useOperationData();
	let codes = $state<TestDeviceCode[]>([]);

	$effect(() => {
		if (session.mode !== 'test') {
			codes = [];
			return;
		}
		void getSession(session.id).then((response) => (codes = response.testDeviceCodes ?? []));
	});

	/** Ended/history rows no longer have a live engine snapshot; retain their REST state. */
	function sessionState(): SessionState {
		return (
			session.live?.state ?? {
				sessionId: session.id,
				themeId: data.themeId,
				mode: session.mode,
				phaseId: session.phaseId,
				state: session.state,
				verdict: session.verdict,
				timerState: null,
				timerRemainingMs: null
			}
		);
	}

	const model: SessionUiModel = {
		get sessionId() {
			return session.id;
		},
		get session() {
			return sessionState();
		},
		get sessionReceivedAt() {
			return session.live?.at ?? Date.now();
		},
		get connected() {
			return data.connected;
		},
		get assets() {
			return data.assets;
		},
		get runs() {
			return data.runsFor(session.id);
		},
		get media() {
			return data.mediaFor(session.id);
		},
		get logs() {
			return data.logs;
		},
		get logsLoading() {
			return data.logsLoading;
		},
		get notifications() {
			return data.notificationsFor(session.id);
		},
		get testDeviceCodes() {
			return codes;
		},
		statusOf(deviceId) {
			return data.deviceStatus.get(`${session.id}:${deviceId}`) ?? null;
		},
		screenshotOf(deviceId) {
			return data.screenshotFor(session.id, deviceId);
		},
		deviceLogsOf(deviceId) {
			return data.deviceLogsFor(session.id, deviceId);
		},
		get call() {
			return data.callFor(session.id);
		},
		get ownsCall() {
			const call = data.callFor(session.id);
			return call !== null && data.ownsCall(call);
		}
	};

	async function refresh<T>(request: Promise<T>): Promise<void> {
		await request;
		await data.refreshSessions();
	}

	const actions: SessionUiActions = {
		async start(resetFirst) {
			if (resetFirst) await resetDevices(session.id);
			await refresh(startSession(session.id));
		},
		pause: () => refresh(pauseSession(session.id)),
		resume: () => refresh(resumeSession(session.id)),
		end: () => refresh(endSession(session.id)),
		adjustTimer: (input) => refresh(adjustTimer(session.id, input)),
		switchPhase: (phaseId) => refresh(switchPhase(session.id, phaseId)),
		restartPhase: () => refresh(restartPhase(session.id)),
		triggerEvent: (eventId) => triggerEvent(session.id, eventId),
		abortRun: (runId) => abortRun(session.id, runId),
		skipRun: (runId) => skipRun(session.id, runId),
		resetDevices: () => resetDevices(session.id),
		runCommand: (command) => runSessionCommand(session.id, command),
		pushHint: (input) => pushHint(session.id, input),
		runTestCallback: (deviceId, name) => runTestCallback(session.id, deviceId, name),
		getDeviceLogs: (deviceId) => getDeviceLogs(session.id, deviceId),
		getSummary: () => getSessionSummary(session.id),
		startCall: (deviceId) => data.startCall(session.id, deviceId),
		acceptCall: (callId) => data.acceptCall(session.id, callId),
		declineCall: (callId) => data.declineCall(session.id, callId),
		endCall: () => data.endCall(session.id)
	};
</script>

<SessionDashboard {model} {actions} {singleColumn} />
