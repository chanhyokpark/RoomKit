<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cache } from '../cache/manager.svelte';
	import { connection } from '../stores/connection.svelte';
	import { stage } from '../stores/stage.svelte';

	// Test sessions only: status bar + skip buttons. Production shows nothing.
	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 250);
	onDestroy(() => clearInterval(tick));

	const remainingMs = $derived.by(() => {
		const session = connection.session;
		if (!session || session.timerRemainingMs === null) return null;
		if (session.timerState !== 'running') return session.timerRemainingMs;
		return Math.max(0, session.timerRemainingMs - (now - connection.sessionReceivedAt));
	});

	function fmt(ms: number): string {
		const total = Math.ceil(ms / 1000);
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	const stateLabel = $derived(
		{
			created: '대기',
			running: '진행 중',
			paused: '일시정지',
			ended: '종료'
		}[connection.session?.state ?? 'created']
	);
</script>

<div
	class="absolute inset-x-0 top-0 z-40 flex items-center gap-3 bg-neutral-950/80 px-4 py-2 text-xs text-neutral-300"
>
	<span class="font-semibold text-amber-400">TEST</span>
	<span>{connection.welcome?.device.displayName ?? connection.welcome?.device.name ?? '—'}</span>
	<span class="text-neutral-500">·</span>
	<span>{stateLabel}</span>
	{#if remainingMs !== null}
		<span class="text-neutral-500">·</span>
		<span class="tabular-nums {connection.session?.timerState === 'paused' ? 'text-yellow-400' : ''}"
			>⏱ {fmt(remainingMs)}</span
		>
	{/if}
	{#if cache.state === 'syncing'}
		<span class="text-neutral-500">·</span>
		<span>
			캐시 동기화 중{cache.progress ? ` (${cache.progress.done}/${cache.progress.total})` : ''}
		</span>
	{/if}
	<span class="ml-auto text-neutral-500">{connection.status}</span>
</div>

{#if stage.skippables.length > 0}
	<div class="absolute right-4 bottom-4 z-40 flex flex-col items-end gap-2">
		{#each stage.skippables as skippable (skippable.id)}
			<button
				class="rounded-md bg-neutral-100/90 px-4 py-2 text-sm font-medium text-neutral-900 shadow hover:bg-white"
				onclick={() => skippable.skip()}
			>
				{skippable.kind === 'dialogue' ? '대사 건너뛰기' : '영상 건너뛰기'} ⏭
			</button>
		{/each}
	</div>
{/if}
