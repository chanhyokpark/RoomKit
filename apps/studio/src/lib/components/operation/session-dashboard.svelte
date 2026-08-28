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
		getSession,
		getSessionSummary,
		pauseSession,
		pushHint,
		resetDevices,
		restartPhase,
		resumeSession,
		runSessionCommand,
		runTestCallback,
		startSession,
		switchPhase,
		triggerEvent
	} from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';

	let { session }: { session: SessionView } = $props();
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
			return [];
		},
		get testDeviceCodes() {
			return codes;
		},
		statusOf(deviceId) {
			return data.deviceStatus.get(`${session.id}:${deviceId}`) ?? null;
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
		resetDevices: () => resetDevices(session.id),
		runCommand: (command) => runSessionCommand(session.id, command),
		pushHint: (input) => pushHint(session.id, input),
		runTestCallback: (deviceId, name) => runTestCallback(session.id, deviceId, name),
		getSummary: () => getSessionSummary(session.id)
	};
</script>

<SessionDashboard {model} {actions} />
