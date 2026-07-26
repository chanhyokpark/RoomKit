<script lang="ts">
	import { onDestroy } from 'svelte';
	import { cache } from '../cache/manager.svelte';
	import { connection } from '../stores/connection.svelte';
	import { stage } from '../stores/stage.svelte';

	// Test sessions only: status bar + trigger sender + skip buttons.
	// Production shows nothing.
	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 250);
	onDestroy(() => clearInterval(tick));

	let collapsed = $state(false);
	let triggerName = $state('');
	let recentTriggers = $state<string[]>([]);
	let sentFlash = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | null = null;
	onDestroy(() => {
		if (flashTimer) clearTimeout(flashTimer);
	});

	const session = $derived(connection.session);

	const remainingMs = $derived.by(() => {
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

	const STATE_META: Record<string, { label: string; class: string }> = {
		created: { label: '대기', class: 'text-neutral-400' },
		running: { label: '진행 중', class: 'text-emerald-400' },
		paused: { label: '일시정지', class: 'text-yellow-400' },
		ended: { label: '종료', class: 'text-red-400' }
	};
	const stateMeta = $derived(STATE_META[session?.state ?? 'created']);

	const timerClass = $derived.by(() => {
		if (session?.timerState === 'expired' || remainingMs === 0) return 'text-red-400';
		if (session?.timerState === 'paused') return 'text-yellow-400';
		return '';
	});

	// ── manual device triggers ─────────────────────────────────────────────────
	// Simulates the `trigger` message a real sensor/button device would send,
	// so game logic can be rehearsed without the physical prop.

	const RECENT_LIMIT = 6;
	const storageKey = $derived.by(() => {
		const deviceId = connection.welcome?.device.id;
		return deviceId ? `roomkit:test-triggers:${deviceId}` : null;
	});

	$effect(() => {
		if (!storageKey) return;
		try {
			const raw = localStorage.getItem(storageKey);
			const parsed: unknown = raw ? JSON.parse(raw) : [];
			recentTriggers = Array.isArray(parsed)
				? parsed.filter((t): t is string => typeof t === 'string').slice(0, RECENT_LIMIT)
				: [];
		} catch {
			recentTriggers = [];
		}
	});

	function sendTrigger(name: string): void {
		const trimmed = name.trim();
		if (!trimmed || !connection.client) return;
		connection.client.trigger(trimmed);
		recentTriggers = [trimmed, ...recentTriggers.filter((t) => t !== trimmed)].slice(
			0,
			RECENT_LIMIT
		);
		if (storageKey) {
			try {
				localStorage.setItem(storageKey, JSON.stringify(recentTriggers));
			} catch {
				// Storage full/unavailable: recents just don't persist.
			}
		}
		triggerName = '';
		sentFlash = trimmed;
		if (flashTimer) clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (sentFlash = null), 1500);
	}
</script>

{#if collapsed}
	<button
		class="absolute top-2 left-2 z-40 rounded-full bg-neutral-950/80 px-3 py-1 text-xs font-semibold text-amber-400 hover:bg-neutral-900"
		onclick={() => (collapsed = false)}
	>
		TEST ▾
	</button>
{:else}
	<div class="z-40 w-full shrink-0 bg-neutral-950/80 text-xs text-neutral-300">
		<div class="flex items-center gap-3 px-4 py-2">
			<span class="font-semibold text-amber-400">TEST</span>
			<span>
				{connection.welcome?.device.displayName ?? connection.welcome?.device.name ?? '—'}
			</span>
			<span class="text-neutral-500">·</span>
			<span class={stateMeta.class}>{stateMeta.label}</span>
			{#if remainingMs !== null}
				<span class="text-neutral-500">·</span>
				<span class="tabular-nums {timerClass}">⏱ {fmt(remainingMs)}</span>
			{/if}
			{#if session?.verdict}
				<span class="text-neutral-500">·</span>
				<span class={session.verdict === 'success' ? 'text-emerald-400' : 'text-red-400'}>
					판정: {session.verdict === 'success' ? '성공' : '실패'}
				</span>
			{/if}
			{#if cache.state === 'syncing'}
				<span class="text-neutral-500">·</span>
				<span>
					캐시 동기화 중{cache.progress ? ` (${cache.progress.done}/${cache.progress.total})` : ''}
				</span>
			{/if}
			<span class="ml-auto text-neutral-500">{connection.status}</span>
			<button
				class="rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
				title="바 접기"
				onclick={() => (collapsed = true)}
			>
				▴
			</button>
		</div>
		<div class="flex flex-wrap items-center gap-2 border-t border-neutral-800 px-4 py-1.5">
			<span class="text-neutral-500">트리거</span>
			<form
				class="flex items-center gap-1.5"
				onsubmit={(submitEvent) => {
					submitEvent.preventDefault();
					sendTrigger(triggerName);
				}}
			>
				<input
					class="h-6 w-44 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs text-neutral-200 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
					placeholder="이벤트 이름 (예: door-open)"
					bind:value={triggerName}
				/>
				<button
					type="submit"
					class="rounded bg-neutral-700 px-2 py-1 font-medium text-neutral-100 hover:bg-neutral-600 disabled:opacity-40"
					disabled={!triggerName.trim() || connection.status !== 'connected'}
				>
					전송
				</button>
			</form>
			{#each recentTriggers as recent (recent)}
				<button
					class="rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-neutral-300 hover:border-neutral-500 hover:text-white"
					title="다시 전송"
					onclick={() => sendTrigger(recent)}
				>
					{recent}
				</button>
			{/each}
			{#if sentFlash}
				<span class="text-emerald-400">✓ {sentFlash} 전송됨</span>
			{/if}
		</div>
	</div>
{/if}

{#if session?.state === 'paused'}
	<div
		class="absolute top-1/2 left-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neutral-950/80 px-4 py-1.5 text-sm text-yellow-400"
	>
		세션 일시정지됨
	</div>
{/if}

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
