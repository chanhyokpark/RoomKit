<script lang="ts">
	import MilestoneIcon from '@lucide/svelte/icons/milestone';
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { assetName, assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model, actions } = useSessionUi();
	let now = $state(Date.now());
	let busy = $state(false);
	let targetPhaseId = $state('');

	const session = $derived(model.session);
	const phases = $derived(
		assetsOf(model.assets, 'phase').toSorted(
			(a, b) => a.data.order - b.data.order || a.name.localeCompare(b.name)
		)
	);
	const targetPhase = $derived(phases.find((phase) => phase.id === targetPhaseId) ?? null);
	const disabled = $derived(
		busy || !session || session.state === 'created' || session.state === 'ended'
	);

	$effect(() => {
		if (session?.timerState !== 'running') return;
		const interval = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(interval);
	});

	const remainingMs = $derived.by(() => {
		if (!session || session.timerRemainingMs === null) return null;
		const elapsed = session.timerState === 'running' ? now - model.sessionReceivedAt : 0;
		return Math.max(0, session.timerRemainingMs - elapsed);
	});

	function formatMs(ms: number): string {
		const total = Math.max(0, Math.round(ms / 1000));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
			: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	async function run(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '요청이 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<TimerIcon />
			타이머
			{#if session?.timerState === 'expired'}
				<Badge variant="destructive">시간 초과</Badge>
			{:else if session?.timerState === 'paused'}
				<Badge variant="secondary">일시정지</Badge>
			{/if}
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if remainingMs === null}
			<p class="text-sm text-muted-foreground">
				{session ? '타이머 없는 테마입니다.' : '라이브 상태를 기다리는 중…'}
			</p>
		{:else}
			<p class="text-center font-mono text-4xl font-semibold tabular-nums">
				{formatMs(remainingMs)}
			</p>
			<div class="flex flex-wrap items-center justify-center gap-1.5">
				{#each [-5, -1, 1, 5] as minutes (minutes)}
					<Button
						size="sm"
						variant="outline"
						disabled={disabled || session?.timerState === 'expired'}
						onclick={() => run(() => actions.adjustTimer({ deltaMs: minutes * 60_000 }))}
					>
						{minutes > 0 ? '+' : ''}{minutes}분
					</Button>
				{/each}
				{#if session?.timerState === 'paused'}
					<Button
						size="sm"
						variant="outline"
						{disabled}
						onclick={() => run(() => actions.adjustTimer({ action: 'resume' }))}
					>
						<PlayIcon data-icon="inline-start" />재개
					</Button>
				{:else}
					<Button
						size="sm"
						variant="outline"
						disabled={disabled || session?.timerState === 'expired'}
						onclick={() => run(() => actions.adjustTimer({ action: 'pause' }))}
					>
						<PauseIcon data-icon="inline-start" />일시정지
					</Button>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2"><MilestoneIcon />페이즈</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<div class="flex items-center gap-2">
			<p class="text-sm">
				현재: <span class="font-medium">
					{session?.phaseId ? (assetName(model.assets, session.phaseId) ?? '(삭제됨)') : '공통'}
				</span>
			</p>
			<Button
				size="sm"
				variant="outline"
				class="ml-auto"
				disabled={disabled || !session?.phaseId}
				onclick={() => run(actions.restartPhase)}
			>
				<RotateCcwIcon data-icon="inline-start" />재시작
			</Button>
		</div>
		<div class="flex items-center gap-2">
			<Select.Root type="single" bind:value={targetPhaseId}>
				<Select.Trigger class="flex-1" {disabled}>
					{targetPhase?.name ?? '페이즈 선택'}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each phases as phase (phase.id)}
							<Select.Item value={phase.id} label={phase.name}>{phase.name}</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			<Button
				size="sm"
				disabled={disabled || !targetPhaseId || targetPhaseId === session?.phaseId}
				onclick={() => run(() => actions.switchPhase(targetPhaseId))}
			>
				전환
			</Button>
		</div>
	</Card.Content>
</Card.Root>
