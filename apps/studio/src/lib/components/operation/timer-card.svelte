<script lang="ts">
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { adjustTimer } from '$lib/api/sessions';
	import type { SessionView } from './operation-data.svelte';

	let { session, disabled }: { session: SessionView; disabled: boolean } = $props();

	const timerState = $derived(session.live?.state.timerState ?? null);

	// No per-second broadcasts: tick locally from the snapshot baseline. Every
	// session:state broadcast resets the baseline, so drift never accumulates.
	let now = $state(Date.now());
	$effect(() => {
		if (timerState !== 'running') return;
		const interval = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(interval);
	});

	const remainingMs = $derived.by(() => {
		const snap = session.live;
		if (!snap || snap.state.timerRemainingMs === null) return null;
		const elapsed = snap.state.timerState === 'running' ? now - snap.at : 0;
		return Math.max(0, snap.state.timerRemainingMs - elapsed);
	});

	const display = $derived.by(() => {
		if (remainingMs === null) return null;
		const total = Math.round(remainingMs / 1000);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		const mm = String(m).padStart(2, '0');
		const ss = String(s).padStart(2, '0');
		return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
	});

	let busy = $state(false);

	async function adjust(input: { deltaMs: number } | { action: 'pause' | 'resume' }) {
		if (busy) return;
		busy = true;
		try {
			await adjustTimer(session.id, input);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : '타이머 조정에 실패했습니다.');
		} finally {
			busy = false;
		}
	}

	const controlsDisabled = $derived(disabled || busy || timerState === 'expired');
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<TimerIcon class="size-4" />
			타이머
			{#if session.state === 'created'}
				<Badge variant="secondary">시작 전</Badge>
			{:else if timerState === 'expired'}
				<Badge variant="destructive">시간 초과</Badge>
			{:else if timerState === 'paused'}
				<Badge variant="secondary">일시정지</Badge>
			{/if}
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if timerState === null || remainingMs === null}
			<p class="text-sm text-muted-foreground">
				{session.live ? '타이머 없는 테마입니다.' : '라이브 상태를 기다리는 중…'}
			</p>
		{:else}
			<p
				class="text-center font-mono text-4xl font-semibold tabular-nums {timerState === 'expired'
					? 'text-destructive'
					: ''}"
			>
				{display}
			</p>
			<div class="flex flex-wrap items-center justify-center gap-1.5">
				<Button
					size="sm"
					variant="outline"
					disabled={controlsDisabled}
					onclick={() => adjust({ deltaMs: -5 * 60_000 })}
				>
					-5분
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={controlsDisabled}
					onclick={() => adjust({ deltaMs: -60_000 })}
				>
					-1분
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={controlsDisabled}
					onclick={() => adjust({ deltaMs: 60_000 })}
				>
					+1분
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={controlsDisabled}
					onclick={() => adjust({ deltaMs: 5 * 60_000 })}
				>
					+5분
				</Button>
				{#if timerState === 'paused'}
					<Button
						size="sm"
						variant="outline"
						disabled={controlsDisabled}
						onclick={() => adjust({ action: 'resume' })}
					>
						<PlayIcon data-icon="inline-start" />
						재개
					</Button>
				{:else}
					<Button
						size="sm"
						variant="outline"
						disabled={controlsDisabled}
						onclick={() => adjust({ action: 'pause' })}
					>
						<PauseIcon data-icon="inline-start" />
						일시정지
					</Button>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
