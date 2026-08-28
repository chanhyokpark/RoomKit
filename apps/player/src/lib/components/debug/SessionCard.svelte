<script lang="ts">
	import { onMount } from 'svelte';
	import { api, ApiError } from '../../api';
	import { admin } from '../../stores/admin.svelte';
	import { themeAssets } from '../../stores/theme-assets.svelte';

	let { sessionId, onchanged }: { sessionId: string; onchanged?: () => void } = $props();

	let busy = $state(false);
	let error = $state('');
	let now = $state(Date.now());
	let phaseChoice = $state('');

	onMount(() => {
		const timer = setInterval(() => (now = Date.now()), 250);
		return () => clearInterval(timer);
	});

	const session = $derived(admin.session);

	const stateLabel = $derived(
		session === null
			? '불러오는 중'
			: { created: '시작 전', running: '진행 중', paused: '일시정지', ended: '종료됨' }[
					session.state
				]
	);

	/** Snapshot + local ticking, mirroring studio's timer card. */
	const remainingMs = $derived.by(() => {
		if (!session || session.timerRemainingMs === null) return null;
		if (session.timerState !== 'running') return session.timerRemainingMs;
		return Math.max(0, session.timerRemainingMs - (now - admin.sessionReceivedAt));
	});

	function formatMs(ms: number): string {
		const total = Math.max(0, Math.round(ms / 1000));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	async function call(path: string, body?: unknown) {
		busy = true;
		error = '';
		try {
			await api(`/sessions/${sessionId}${path}`, { method: 'POST', ...(body ? { body } : {}) });
			onchanged?.();
		} catch (err) {
			error = err instanceof ApiError ? err.message : '요청이 실패했습니다.';
		} finally {
			busy = false;
		}
	}

	const btn =
		'rounded-md border border-neutral-700 px-2.5 py-1.5 text-sm hover:bg-neutral-800 disabled:opacity-40';
	const primaryBtn =
		'rounded-md bg-neutral-100 px-2.5 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40';
</script>

<section class="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-neutral-300">세션</h2>
		<span class="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300">{stateLabel}</span>
	</div>

	<div class="flex flex-wrap gap-2">
		{#if session?.state === 'created'}
			<button class={primaryBtn} disabled={busy} onclick={() => void call('/start')}>
				세션 시작
			</button>
		{:else if session?.state === 'running'}
			<button class={btn} disabled={busy} onclick={() => void call('/pause')}>일시정지</button>
		{:else if session?.state === 'paused'}
			<button class={primaryBtn} disabled={busy} onclick={() => void call('/resume')}>재개</button>
		{/if}
		{#if session && session.state !== 'ended'}
			<button class={btn} disabled={busy} onclick={() => void call('/end')}>세션 종료</button>
			<button class={btn} disabled={busy} onclick={() => void call('/reset-devices')}>
				디바이스 전체 리셋
			</button>
		{/if}
		{#if session?.verdict}
			<span class="self-center text-xs text-neutral-400">
				결과: {session.verdict === 'success' ? '성공' : '실패'}
			</span>
		{/if}
	</div>

	<div class="flex items-center gap-3 border-t border-neutral-800 pt-3">
		<span class="w-14 text-xs text-neutral-400">타이머</span>
		<span class="font-mono text-xl tabular-nums">
			{remainingMs === null ? '—' : formatMs(remainingMs)}
		</span>
		{#if session?.timerState}
			<span class="text-xs text-neutral-500">
				{{ running: '진행', paused: '정지', expired: '만료' }[session.timerState]}
			</span>
		{/if}
		<div class="ml-auto flex gap-1.5">
			<button class={btn} disabled={busy} onclick={() => void call('/timer', { deltaMs: -60_000 })}>
				-1분
			</button>
			<button class={btn} disabled={busy} onclick={() => void call('/timer', { deltaMs: 60_000 })}>
				+1분
			</button>
			<button class={btn} disabled={busy} onclick={() => void call('/timer', { deltaMs: 300_000 })}>
				+5분
			</button>
			{#if session?.timerState === 'running'}
				<button class={btn} disabled={busy} onclick={() => void call('/timer', { action: 'pause' })}>
					정지
				</button>
			{:else if session?.timerState === 'paused'}
				<button
					class={btn}
					disabled={busy}
					onclick={() => void call('/timer', { action: 'resume' })}
				>
					재개
				</button>
			{/if}
		</div>
	</div>

	<div class="flex items-center gap-3 border-t border-neutral-800 pt-3">
		<span class="w-14 text-xs text-neutral-400">페이즈</span>
		<span class="text-sm">{themeAssets.phaseName(session?.phaseId ?? null)}</span>
		<div class="ml-auto flex gap-1.5">
			<select
				class="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none"
				bind:value={phaseChoice}
			>
				<option value="">페이즈 선택</option>
				{#each themeAssets.phases as phase (phase.id)}
					<option value={phase.id}>{phase.name}</option>
				{/each}
			</select>
			<button
				class={btn}
				disabled={busy || !phaseChoice || phaseChoice === session?.phaseId}
				onclick={() => void call('/phase', { phaseId: phaseChoice })}
			>
				전환
			</button>
			<button class={btn} disabled={busy} onclick={() => void call('/phase/restart')}>
				재시작
			</button>
		</div>
	</div>

	{#each admin.notifications as notification, i (i)}
		<p class="rounded-md border border-sky-900 bg-sky-950/40 px-3 py-1.5 text-xs text-sky-300">
			{notification.message}
		</p>
	{/each}

	{#if error}
		<p class="text-xs text-red-400">{error}</p>
	{/if}
</section>
