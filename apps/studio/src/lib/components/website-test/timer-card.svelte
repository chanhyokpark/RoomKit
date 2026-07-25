<script lang="ts">
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import TimerIcon from '@lucide/svelte/icons/timer';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { useWebsiteTestData } from './website-test-data.svelte';

	const data = useWebsiteTestData();
	const run = $derived(data.run!);
	const timerState = $derived(run.timerState);

	// No per-second broadcasts: tick locally from the snapshot baseline.
	let now = $state(Date.now());
	$effect(() => {
		if (timerState !== 'running') return;
		const interval = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(interval);
	});

	const remainingMs = $derived.by(() => {
		if (run.timerRemainingMs === null) return null;
		const elapsed = timerState === 'running' ? now - data.runReceivedAt : 0;
		return Math.max(0, run.timerRemainingMs - elapsed);
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

	let minutesDraft = $state('');
	let busy = $state(false);

	async function apply(input: { remainingMs: number } | { action: 'pause' | 'resume' }) {
		if (busy) return;
		busy = true;
		try {
			await data.setTimer(input);
		} finally {
			busy = false;
		}
	}

	function setMinutes(): void {
		const minutes = Number(minutesDraft);
		if (!Number.isFinite(minutes) || minutes < 0) return;
		void apply({ remainingMs: Math.round(minutes * 60_000) });
		minutesDraft = '';
	}

	function adjustBy(deltaMs: number): void {
		if (remainingMs === null) return;
		void apply({ remainingMs: Math.max(0, remainingMs + deltaMs) });
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<TimerIcon class="size-4" />
			타이머
			{#if timerState === 'expired'}
				<Badge variant="destructive">시간 초과</Badge>
			{:else if timerState === 'paused'}
				<Badge variant="secondary">일시정지</Badge>
			{/if}
		</Card.Title>
		<Card.Description>
			웹사이트의 getRemainingTime()이 이 값을 받습니다. 실제 세션 없이 자유롭게 조정하세요.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if remainingMs === null}
			<p class="text-sm text-muted-foreground">
				타이머 없는 테마입니다. 시간을 설정하면 타이머가 시작됩니다.
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
				<Button size="sm" variant="outline" disabled={busy} onclick={() => adjustBy(-5 * 60_000)}>
					-5분
				</Button>
				<Button size="sm" variant="outline" disabled={busy} onclick={() => adjustBy(-60_000)}>
					-1분
				</Button>
				<Button size="sm" variant="outline" disabled={busy} onclick={() => adjustBy(60_000)}>
					+1분
				</Button>
				<Button size="sm" variant="outline" disabled={busy} onclick={() => adjustBy(5 * 60_000)}>
					+5분
				</Button>
				{#if timerState === 'paused'}
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onclick={() => apply({ action: 'resume' })}
					>
						<PlayIcon data-icon="inline-start" />
						재개
					</Button>
				{:else}
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						onclick={() => apply({ action: 'pause' })}
					>
						<PauseIcon data-icon="inline-start" />
						일시정지
					</Button>
				{/if}
			</div>
		{/if}
		<div class="flex items-center justify-center gap-2">
			<Input
				class="h-8 w-24"
				type="number"
				min="0"
				step="1"
				placeholder="분"
				bind:value={minutesDraft}
				aria-label="타이머 설정 (분)"
				onkeydown={(keyEvent) => {
					if (keyEvent.key === 'Enter') setMinutes();
				}}
			/>
			<Button
				size="sm"
				variant="outline"
				disabled={busy || minutesDraft === ''}
				onclick={setMinutes}
			>
				분으로 설정
			</Button>
		</div>
	</Card.Content>
</Card.Root>
