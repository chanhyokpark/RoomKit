<script lang="ts">
	import { onMount } from 'svelte';
	import type { SessionLogEntry, SessionResponse } from '@roomkit/shared';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
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

<main class="flex h-full flex-col gap-4 overflow-y-auto bg-background p-5">
	<header class="flex items-center justify-between">
		<div class="flex items-center gap-2.5">
			<h1 class="text-lg font-semibold">테스트 디버그</h1>
			<Badge variant="secondary" class="font-mono">{sessionId.slice(0, 8)}</Badge>
		</div>
		<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<span class="h-2 w-2 rounded-full {admin.connected ? 'bg-emerald-400' : 'bg-muted'}"></span>
			{admin.connected ? '실시간 연결됨' : '연결 끊김'}
		</span>
	</header>

	{#if !auth.loggedIn}
		<Card.Root class="mx-auto mt-16 w-80">
			<Card.Header>
				<Card.Description>디버그 창을 사용하려면 관리자 로그인이 필요합니다.</Card.Description>
			</Card.Header>
			<Card.Content>
				<form class="flex flex-col gap-3" onsubmit={submitLogin}>
					<Input placeholder="아이디" bind:value={loginId} />
					<Input type="password" placeholder="비밀번호" bind:value={loginPassword} />
					<Button type="submit" disabled={auth.status === 'pending'}>로그인</Button>
					{#if auth.error}
						<p class="text-xs text-destructive">{auth.error}</p>
					{/if}
				</form>
			</Card.Content>
		</Card.Root>
	{:else if loadError}
		<Alert.Root variant="destructive">
			<Alert.Description>{loadError}</Alert.Description>
		</Alert.Root>
	{:else if !ready}
		<p class="text-sm text-muted-foreground">불러오는 중…</p>
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
