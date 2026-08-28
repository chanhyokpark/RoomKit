<script lang="ts">
	import { onMount } from 'svelte';
	import type { SessionLogEntry, SessionResponse } from '@roomkit/shared';
	import { api } from '../../api';
	import { admin } from '../../stores/admin.svelte';
	import { auth } from '../../stores/auth.svelte';
	import { config } from '../../stores/config.svelte';
	import { themeAssets } from '../../stores/theme-assets.svelte';
	import CommandCard from './CommandCard.svelte';
	import DevicesCard from './DevicesCard.svelte';
	import EventsCard from './EventsCard.svelte';
	import LogCard from './LogCard.svelte';
	import SessionCard from './SessionCard.svelte';

	let { sessionId, themeId }: { sessionId: string; themeId: string } = $props();

	let ready = $state(false);
	let loginId = $state('');
	let loginPassword = $state('');
	let sessionInfo = $state<SessionResponse | null>(null);
	let loadError = $state('');

	async function boot() {
		if (!auth.loggedIn && !(await auth.relogin())) {
			ready = false;
			return;
		}
		try {
			admin.start(sessionId);
			await Promise.all([
				themeAssets.load(themeId),
				api<SessionResponse>(`/sessions/${sessionId}`).then((s) => (sessionInfo = s)),
				api<SessionLogEntry[]>(`/sessions/${sessionId}/logs`, { query: { limit: '200' } }).then(
					(entries) => admin.appendLogs(entries)
				)
			]);
			ready = true;
		} catch (err) {
			loadError = err instanceof Error ? err.message : '세션 정보를 불러오지 못했습니다.';
		}
	}

	onMount(() => {
		void boot();
		return () => admin.stop();
	});

	async function submitLogin(event: SubmitEvent) {
		event.preventDefault();
		if (await auth.login(loginId.trim(), loginPassword)) {
			loginPassword = '';
			void boot();
		}
	}

	async function refreshSessionInfo() {
		try {
			sessionInfo = await api<SessionResponse>(`/sessions/${sessionId}`);
		} catch {
			// The live socket still carries state; the REST snapshot is best-effort.
		}
	}
</script>

<main class="flex h-full flex-col gap-4 overflow-y-auto bg-neutral-950 p-5">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-2.5">
			<h1 class="text-lg font-semibold">테스트 디버그</h1>
			<span class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-xs text-neutral-400">
				{sessionId.slice(0, 8)}
			</span>
		</div>
		<span class="flex items-center gap-1.5 text-xs text-neutral-400">
			<span
				class="h-2 w-2 rounded-full {admin.connected ? 'bg-emerald-400' : 'bg-neutral-600'}"
			></span>
			{admin.connected ? '실시간 연결됨' : '연결 끊김'}
		</span>
	</header>

	{#if !auth.loggedIn}
		<form
			class="mx-auto mt-16 flex w-80 flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-5"
			onsubmit={submitLogin}
		>
			<p class="text-sm text-neutral-300">디버그 창을 사용하려면 관리자 로그인이 필요합니다.</p>
			<input
				class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
				placeholder="아이디"
				bind:value={loginId}
			/>
			<input
				class="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-400"
				type="password"
				placeholder="비밀번호"
				bind:value={loginPassword}
			/>
			<button
				class="rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
				type="submit"
				disabled={auth.status === 'pending'}
			>
				로그인
			</button>
			{#if auth.error}
				<p class="text-xs text-red-400">{auth.error}</p>
			{/if}
		</form>
	{:else if loadError}
		<p class="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
			{loadError}
		</p>
	{:else if !ready}
		<p class="text-sm text-neutral-500">불러오는 중…</p>
	{:else}
		<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
			<div class="flex flex-col gap-4">
				<SessionCard {sessionId} onchanged={refreshSessionInfo} />
				<DevicesCard {sessionId} {sessionInfo} />
				<CommandCard {sessionId} />
			</div>
			<div class="flex flex-col gap-4">
				<EventsCard {sessionId} />
				<LogCard />
			</div>
		</div>
	{/if}
</main>
