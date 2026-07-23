<script lang="ts">
	import MilestoneIcon from '@lucide/svelte/icons/milestone';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { restartPhase, switchPhase } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import { toastApiError } from '$lib/api/client';

	let { session, disabled }: { session: SessionView; disabled: boolean } = $props();

	const data = useOperationData();

	let targetPhaseId = $state('');
	let confirming = $state(false);
	let confirmingRestart = $state(false);
	let busy = $state(false);

	const currentPhaseName = $derived(
		session.phaseId === null ? null : (data.assetName(session.phaseId) ?? '(삭제된 페이즈)')
	);
	const targetPhase = $derived(data.phases.find((p) => p.id === targetPhaseId) ?? null);

	async function handleSwitch(): Promise<void> {
		if (busy || !targetPhaseId) return;
		busy = true;
		try {
			await switchPhase(session.id, targetPhaseId);
			targetPhaseId = '';
		} catch (err) {
			toastApiError(err, '페이즈 전환에 실패했습니다.');
		} finally {
			busy = false;
		}
	}

	async function handleRestart(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await restartPhase(session.id);
		} catch (err) {
			toastApiError(err, '페이즈 재시작에 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<MilestoneIcon class="size-4" />
			페이즈
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<p class="text-sm">
				현재: <span class="font-medium">{currentPhaseName ?? '없음 (공통만)'}</span>
			</p>
			{#if session.phaseId !== null}
				<Button
					size="sm"
					variant="outline"
					class="ml-auto"
					disabled={disabled || busy}
					onclick={() => (confirmingRestart = true)}
				>
					<RotateCcwIcon data-icon="inline-start" />
					재시작
				</Button>
			{/if}
		</div>
		{#if data.phases.length === 0}
			<p class="text-sm text-muted-foreground">페이즈가 없습니다.</p>
		{:else}
			<div class="flex items-center gap-2">
				<Select.Root type="single" bind:value={targetPhaseId}>
					<Select.Trigger class="flex-1" disabled={disabled || busy}>
						{targetPhase?.name ?? '페이즈 선택'}
					</Select.Trigger>
					<Select.Content>
						{#each data.phases as phase (phase.id)}
							<Select.Item value={phase.id} label={phase.name}>{phase.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					size="sm"
					disabled={disabled || busy || !targetPhaseId || targetPhaseId === session.phaseId}
					onclick={() => (confirming = true)}
				>
					전환
				</Button>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<AlertDialog.Root
	open={confirmingRestart}
	onOpenChange={(value) => {
		if (!value) confirmingRestart = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>현재 페이즈를 재시작할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				"{currentPhaseName}" 페이즈의 이탈 훅과 진입 훅을 다시 실행합니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>취소</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					confirmingRestart = false;
					void handleRestart();
				}}
			>
				재시작
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
	open={confirming}
	onOpenChange={(value) => {
		if (!value) confirming = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>페이즈를 전환할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				"{targetPhase?.name}" 페이즈로 강제 전환합니다. 페이즈 진입/이탈 훅이 실행됩니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>취소</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					confirming = false;
					void handleSwitch();
				}}
			>
				전환
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
