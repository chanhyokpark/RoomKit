<script lang="ts">
	import { onMount } from 'svelte';
	import {
		SessionDashboard,
		type SessionUiActions,
		type SessionUiModel
	} from '@roomkit/session-ui';
	import {
		SessionLogEntrySchema,
		SessionResponseSchema,
		SessionSummarySchema,
		type Command,
		type PushHintInput,
		type SessionResponse,
		type SessionState,
		type SessionSummary
	} from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { api } from '../../api';
	import { admin } from '../../stores/admin.svelte';
	import { auth } from '../../stores/auth.svelte';
	import { themeAssets } from '../../stores/theme-assets.svelte';

	let { sessionId, themeId }: { sessionId: string; themeId: string } = $props();

	let ready = $state(false);
	let loginId = $state('');
	let loginPassword = $state('');
	let sessionInfo = $state<SessionResponse | null>(null);
	let testDeviceCodes = $state<SessionResponse['testDeviceCodes']>([]);
	let loadError = $state('');

	async function boot(): Promise<void> {
		if (!auth.loggedIn && !(await auth.relogin())) {
			ready = false;
			return;
		}
		try {
			admin.start(sessionId);
			await Promise.all([
				themeAssets.load(themeId),
				loadSessionInfo(),
				api<unknown[]>(`/sessions/${sessionId}/logs`, {
					query: { limit: '500' }
				}).then((rows) =>
					admin.appendLogs(
						rows.flatMap((row) => {
							const parsed = SessionLogEntrySchema.safeParse(row);
							return parsed.success ? [parsed.data] : [];
						})
					)
				)
			]);
			ready = true;
		} catch (error) {
			loadError = error instanceof Error ? error.message : '세션 정보를 불러오지 못했습니다.';
		}
	}

	onMount(() => {
		void boot();
		return () => admin.stop();
	});

	async function submitLogin(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (await auth.login(loginId.trim(), loginPassword)) {
			loginPassword = '';
			void boot();
		}
	}

	async function refreshSessionInfo(): Promise<void> {
		await loadSessionInfo();
	}

	async function loadSessionInfo(): Promise<void> {
		const response = SessionResponseSchema.parse(await api<unknown>(`/sessions/${sessionId}`));
		sessionInfo = response;
		if ((response.testDeviceCodes?.length ?? 0) > 0) testDeviceCodes = response.testDeviceCodes;
	}

	function fallbackSession(): SessionState | null {
		if (!sessionInfo) return null;
		const runningTimer = sessionInfo.timerEndsAt !== null;
		return {
			sessionId,
			themeId,
			mode: sessionInfo.mode,
			phaseId: sessionInfo.phaseId,
			state: sessionInfo.state,
			verdict: sessionInfo.verdict,
			timerState: runningTimer
				? 'running'
				: sessionInfo.timerRemainingMs !== null
					? 'paused'
					: null,
			timerRemainingMs: runningTimer
				? Math.max(0, sessionInfo.timerEndsAt!.getTime() - Date.now())
				: sessionInfo.timerRemainingMs
		};
	}

	const model: SessionUiModel = {
		get sessionId() {
			return sessionId;
		},
		get session() {
			return admin.session ?? fallbackSession();
		},
		get sessionReceivedAt() {
			return admin.session ? admin.sessionReceivedAt : Date.now();
		},
		get connected() {
			return admin.connected;
		},
		get assets() {
			return themeAssets.assets;
		},
		get runs() {
			return admin.runs;
		},
		get media() {
			return admin.media;
		},
		get logs() {
			return admin.logs.toReversed();
		},
		get logsLoading() {
			return !ready;
		},
		get notifications() {
			return admin.notifications;
		},
		get testDeviceCodes() {
			return testDeviceCodes ?? [];
		},
		statusOf(deviceId) {
			return admin.deviceStatus[deviceId] ?? null;
		}
	};

	async function post(path: string, body?: unknown): Promise<void> {
		await api(`/sessions/${sessionId}${path}`, {
			method: 'POST',
			...(body === undefined ? {} : { body })
		});
	}

	const actions: SessionUiActions = {
		async start(resetFirst) {
			if (resetFirst) await post('/reset-devices');
			await post('/start');
			await refreshSessionInfo();
		},
		async pause() {
			await post('/pause');
			await refreshSessionInfo();
		},
		async resume() {
			await post('/resume');
			await refreshSessionInfo();
		},
		async end() {
			await post('/end');
			await refreshSessionInfo();
		},
		adjustTimer: (input) => post('/timer', input),
		switchPhase: (phaseId) => post('/phase', { phaseId }),
		restartPhase: () => post('/phase/restart'),
		triggerEvent: (eventId) => post('/trigger', { eventId }),
		abortRun: (runId) => post(`/runs/${runId}/abort`),
		resetDevices: () => post('/reset-devices'),
		runCommand: (command: Command) => post('/command', command),
		pushHint: (input: PushHintInput) => post('/hint', input),
		runTestCallback: (deviceId, name) =>
			api<{ ok: boolean }>(`/sessions/${sessionId}/devices/${deviceId}/test-callback`, {
				method: 'POST',
				body: { name }
			}),
		getSummary: async () =>
			SessionSummarySchema.parse(
				await api<unknown>(`/sessions/${sessionId}/summary`)
			) as SessionSummary
	};
</script>

<main class="flex h-full flex-col overflow-y-auto bg-background text-foreground">
	<header class="flex shrink-0 items-center gap-2 border-b px-4 py-3">
		<h1 class="text-lg font-semibold">세션 디버그</h1>
		<Badge variant="secondary" class="font-mono">{sessionId.slice(0, 8)}</Badge>
	</header>

	{#if !auth.loggedIn}
		<Card.Root class="mx-auto mt-16 w-80">
			<Card.Header>
				<Card.Title>관리자 로그인</Card.Title>
				<Card.Description>세션 디버그 도구를 사용하려면 로그인하세요.</Card.Description>
			</Card.Header>
			<Card.Content>
				<form onsubmit={submitLogin}>
					<Field.FieldGroup>
						<Field.Field>
							<Field.FieldLabel for="debug-login-id">아이디</Field.FieldLabel>
							<Input id="debug-login-id" bind:value={loginId} autocomplete="username" />
						</Field.Field>
						<Field.Field>
							<Field.FieldLabel for="debug-login-password">비밀번호</Field.FieldLabel>
							<Input
								id="debug-login-password"
								type="password"
								bind:value={loginPassword}
								autocomplete="current-password"
							/>
						</Field.Field>
						<Button type="submit" disabled={auth.status === 'pending'}>로그인</Button>
						{#if auth.error}<p class="text-xs text-destructive">
								{auth.error}
							</p>{/if}
					</Field.FieldGroup>
				</form>
			</Card.Content>
		</Card.Root>
	{:else if loadError}
		<Card.Root class="m-4">
			<Card.Header><Card.Title>세션을 불러오지 못했습니다.</Card.Title></Card.Header>
			<Card.Content><p class="text-sm text-destructive">{loadError}</p></Card.Content>
		</Card.Root>
	{:else if !ready}
		<p class="p-4 text-sm text-muted-foreground">불러오는 중…</p>
	{:else}
		<SessionDashboard {model} {actions} />
	{/if}
</main>
