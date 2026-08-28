<script lang="ts">
	import { onMount } from 'svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
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
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>세션</Card.Title>
		<Card.Action>
			<Badge variant="secondary">{stateLabel}</Badge>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<div class="flex flex-wrap gap-2">
			{#if session?.state === 'created'}
				<Button size="sm" disabled={busy} onclick={() => void call('/start')}>세션 시작</Button>
			{:else if session?.state === 'running'}
				<Button variant="outline" size="sm" disabled={busy} onclick={() => void call('/pause')}>
					일시정지
				</Button>
			{:else if session?.state === 'paused'}
				<Button size="sm" disabled={busy} onclick={() => void call('/resume')}>재개</Button>
			{/if}
			{#if session && session.state !== 'ended'}
				<Button variant="outline" size="sm" disabled={busy} onclick={() => void call('/end')}>
					세션 종료
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => void call('/reset-devices')}
				>
					디바이스 전체 리셋
				</Button>
			{/if}
			{#if session?.verdict}
				<span class="self-center text-xs text-muted-foreground">
					결과: {session.verdict === 'success' ? '성공' : '실패'}
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-3 border-t pt-3">
			<span class="w-14 text-xs text-muted-foreground">타이머</span>
			<span class="font-mono text-xl tabular-nums">
				{remainingMs === null ? '—' : formatMs(remainingMs)}
			</span>
			{#if session?.timerState}
				<span class="text-xs text-muted-foreground">
					{{ running: '진행', paused: '정지', expired: '만료' }[session.timerState]}
				</span>
			{/if}
			<div class="ml-auto flex gap-1.5">
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => void call('/timer', { deltaMs: -60_000 })}
				>
					-1분
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => void call('/timer', { deltaMs: 60_000 })}
				>
					+1분
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => void call('/timer', { deltaMs: 300_000 })}
				>
					+5분
				</Button>
				{#if session?.timerState === 'running'}
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => void call('/timer', { action: 'pause' })}
					>
						정지
					</Button>
				{:else if session?.timerState === 'paused'}
					<Button
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => void call('/timer', { action: 'resume' })}
					>
						재개
					</Button>
				{/if}
			</div>
		</div>

		<div class="flex items-center gap-3 border-t pt-3">
			<span class="w-14 text-xs text-muted-foreground">페이즈</span>
			<span class="text-sm">{themeAssets.phaseName(session?.phaseId ?? null)}</span>
			<div class="ml-auto flex gap-1.5">
				<Select.Root type="single" bind:value={phaseChoice}>
					<Select.Trigger size="sm" class="w-36">
						{themeAssets.phases.find((p) => p.id === phaseChoice)?.name ?? '페이즈 선택'}
					</Select.Trigger>
					<Select.Content>
						{#each themeAssets.phases as phase (phase.id)}
							<Select.Item value={phase.id} label={phase.name}>{phase.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					variant="outline"
					size="sm"
					disabled={busy || !phaseChoice || phaseChoice === session?.phaseId}
					onclick={() => void call('/phase', { phaseId: phaseChoice })}
				>
					전환
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={busy}
					onclick={() => void call('/phase/restart')}
				>
					재시작
				</Button>
			</div>
		</div>

		{#each admin.notifications as notification, i (i)}
			<Alert.Root>
				<Alert.Description>{notification.message}</Alert.Description>
			</Alert.Root>
		{/each}

		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>
