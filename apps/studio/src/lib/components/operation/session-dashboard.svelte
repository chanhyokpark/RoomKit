<script lang="ts">
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import { endSession, pauseSession, resumeSession } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import DeviceStatusCard from './device-status-card.svelte';
	import EventTriggerCard from './event-trigger-card.svelte';
	// Hint push is hidden for now — restore the import and the card below to bring it back.
	// import HintPushCard from './hint-push-card.svelte';
	import PhaseCard from './phase-card.svelte';
	import RunningEventsCard from './running-events-card.svelte';
	import SessionSummaryCard from './session-summary-card.svelte';
	import StartSessionDialog from './start-session-dialog.svelte';
	import TimerCard from './timer-card.svelte';
	import { toastApiError } from '$lib/api/client';

	let { session }: { session: SessionView } = $props();

	const data = useOperationData();

	let busy = $state(false);
	let confirmEnd = $state(false);
	let startDialogOpen = $state(false);

	const ended = $derived(session.state === 'ended');
	const notStarted = $derived(session.state === 'created');
	// Game controls stay locked until the session starts; device reset works earlier.
	const gameDisabled = $derived(busy || ended || notStarted);

	const stateLabels: Record<SessionView['state'], string> = {
		created: '시작 전',
		running: '진행 중',
		paused: '일시정지',
		ended: '종료됨'
	};

	// No optimistic updates: call REST, then trust the session:state broadcast.
	async function run(action: () => Promise<unknown>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
			await data.refreshSessions();
		} catch (err) {
			toastApiError(err, '요청이 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<div class="flex flex-col gap-4 p-4">
	<div class="flex flex-wrap items-center gap-2">
		<Badge variant={session.mode === 'production' ? 'default' : 'secondary'}>
			{session.mode === 'production' ? '프로덕션' : '테스트'}
		</Badge>
		<Badge
			variant={session.state === 'running'
				? 'outline'
				: session.state === 'ended'
					? 'destructive'
					: 'secondary'}
		>
			{stateLabels[session.state]}
		</Badge>
		<div class="ml-auto flex items-center gap-2">
			{#if busy}<Spinner />{/if}
			{#if session.state === 'created'}
				<Button size="sm" disabled={busy} onclick={() => (startDialogOpen = true)}>
					<PlayIcon data-icon="inline-start" />
					세션 시작
				</Button>
			{:else if session.state === 'running'}
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onclick={() => run(() => pauseSession(session.id))}
				>
					<PauseIcon data-icon="inline-start" />
					일시정지
				</Button>
			{:else if session.state === 'paused'}
				<Button
					size="sm"
					variant="outline"
					disabled={busy}
					onclick={() => run(() => resumeSession(session.id))}
				>
					<PlayIcon data-icon="inline-start" />
					재개
				</Button>
			{/if}
			<Button
				size="sm"
				variant="destructive"
				disabled={busy || ended}
				onclick={() => (confirmEnd = true)}
			>
				<SquareIcon data-icon="inline-start" />
				세션 종료
			</Button>
		</div>
	</div>

	{#if ended}
		<SessionSummaryCard {session} />
	{/if}

	<div class="grid gap-4 md:grid-cols-2">
		<TimerCard {session} disabled={gameDisabled} />
		<PhaseCard {session} disabled={gameDisabled} />
		<RunningEventsCard {session} />
		<EventTriggerCard {session} disabled={gameDisabled} />
		<DeviceStatusCard {session} disabled={busy || ended} />
		<!-- <HintPushCard {session} disabled={gameDisabled} /> -->
	</div>
</div>

<StartSessionDialog bind:open={startDialogOpen} {session} />

<AlertDialog.Root
	open={confirmEnd}
	onOpenChange={(value) => {
		if (!value) confirmEnd = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>세션을 종료할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				실행 중인 시퀀스가 모두 중단됩니다. 종료된 세션은 다시 시작할 수 없습니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>취소</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					confirmEnd = false;
					void run(() => endSession(session.id));
				}}
			>
				종료
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
