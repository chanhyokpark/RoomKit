<script lang="ts">
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Spinner } from '$lib/components/ui/spinner';
	import type { SessionSummary } from '@roomkit/shared';
	import { getSessionSummary } from '$lib/api/sessions';
	import { ApiError } from '$lib/api/client';
	import { useOperationData, type SessionView } from './operation-data.svelte';

	let { session }: { session: SessionView } = $props();

	const data = useOperationData();

	let summary = $state<SessionSummary | null>(null);
	let loading = $state(true);
	let failed = $state(false);
	let requestId = 0;

	async function load(sessionId: string): Promise<void> {
		const rid = ++requestId;
		loading = true;
		failed = false;
		summary = null;
		for (let attempt = 0; ; attempt++) {
			try {
				const result = await getSessionSummary(sessionId);
				if (rid !== requestId) return;
				summary = result;
				loading = false;
				return;
			} catch (err) {
				if (rid !== requestId) return;
				// The engine broadcasts 'ended' before the row persists — brief 409s
				// right after the game ends resolve on their own.
				if (err instanceof ApiError && err.status === 409 && attempt < 3) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
					if (rid !== requestId) return;
					continue;
				}
				failed = true;
				loading = false;
				return;
			}
		}
	}

	$effect(() => {
		void load(session.id);
		return () => {
			requestId++;
		};
	});

	function fmt(ms: number): string {
		const total = Math.round(ms / 1000);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		const mm = String(m).padStart(2, '0');
		const ss = String(s).padStart(2, '0');
		return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
	}

	// Monochrome opacity ramp: readable in both themes without a chart palette.
	const RAMP = ['bg-primary/80', 'bg-primary/60', 'bg-primary/40', 'bg-primary/25'];

	/** Summary rows in the theme's phase order; unknown/deleted ids last. */
	const phaseRows = $derived.by(() => {
		if (!summary) return [];
		const order = new Map(data.phases.map((phase, index) => [phase.id, index]));
		return summary.phases.toSorted(
			(a, b) =>
				(order.get(a.phaseId ?? '') ?? Number.MAX_SAFE_INTEGER) -
				(order.get(b.phaseId ?? '') ?? Number.MAX_SAFE_INTEGER)
		);
	});
	const barTotalMs = $derived(phaseRows.reduce((sum, row) => sum + row.activeMs, 0));

	const totalHintShows = $derived(summary?.hints.reduce((sum, h) => sum + h.shows, 0) ?? 0);
	const totalAdminPushes = $derived(summary?.hints.reduce((sum, h) => sum + h.adminPushes, 0) ?? 0);

	const interventions = $derived.by(() => {
		if (!summary) return [];
		const parts: string[] = [];
		if (summary.phaseRestartCount > 0) parts.push(`페이즈 재시작 ${summary.phaseRestartCount}회`);
		if (summary.timer && summary.timer.adjustmentCount > 0) {
			parts.push(`타이머 조정 ${summary.timer.adjustmentCount}회`);
		}
		return parts;
	});

	function phaseName(phaseId: string | null): string {
		if (phaseId === null) return '페이즈 없음';
		return data.assetName(phaseId) ?? '(삭제된 페이즈)';
	}

	function hintName(hintId: string, code: string | null): string {
		return data.assetName(hintId) ?? (code !== null ? `코드 ${code}` : '(삭제된 힌트)');
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ChartColumnIcon class="size-4" />
			세션 결과
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
				<Spinner class="size-4" />
				결과를 불러오는 중…
			</div>
		{:else if failed || summary === null}
			<div class="flex flex-col items-center gap-2 py-6">
				<p class="text-sm text-muted-foreground">세션 결과를 불러오지 못했습니다.</p>
				<Button size="sm" variant="outline" onclick={() => load(session.id)}>다시 시도</Button>
			</div>
		{:else}
			<div
				class="flex items-center gap-2 rounded-lg border p-3 {summary.verdict === 'success'
					? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
					: summary.verdict === 'fail'
						? 'border-destructive/50 bg-destructive/10 text-destructive'
						: 'bg-muted/50 text-muted-foreground'}"
			>
				{#if summary.verdict === 'success'}
					<TrophyIcon class="size-4 shrink-0" />
				{:else if summary.verdict === 'fail'}
					<XCircleIcon class="size-4 shrink-0" />
				{:else}
					<FlagIcon class="size-4 shrink-0" />
				{/if}
				<p class="text-sm font-medium">
					{#if summary.verdict !== null}
						테마 종료 — 판정: {summary.verdict === 'success' ? '성공' : '실패'}
					{:else}
						세션 종료 — 판정 없음 (수동 종료)
					{/if}
				</p>
			</div>

			<div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
				<div class="rounded-lg border p-3">
					<p class="text-xs text-muted-foreground">총 플레이 시간</p>
					<p class="font-mono text-lg font-semibold tabular-nums">{fmt(summary.totalActiveMs)}</p>
					{#if summary.totalPausedMs > 0}
						<p class="text-xs text-muted-foreground">일시정지 포함 {fmt(summary.totalWallMs)}</p>
					{/if}
				</div>
				{#if summary.timer !== null}
					<div class="rounded-lg border p-3">
						<p class="text-xs text-muted-foreground">남은 시간</p>
						{#if summary.timer.expired}
							<p class="text-lg font-semibold text-destructive">시간 초과</p>
						{:else if summary.timer.remainingMsAtEnd !== null}
							<p class="font-mono text-lg font-semibold tabular-nums">
								{fmt(summary.timer.remainingMsAtEnd)}
							</p>
						{:else}
							<p class="text-lg font-semibold text-muted-foreground">—</p>
						{/if}
						{#if summary.timer.timeLimitMs !== null}
							<p class="text-xs text-muted-foreground">제한 {fmt(summary.timer.timeLimitMs)}</p>
						{/if}
					</div>
				{/if}
				<div class="rounded-lg border p-3">
					<p class="text-xs text-muted-foreground">힌트 사용</p>
					<p class="font-mono text-lg font-semibold tabular-nums">{totalHintShows}회</p>
					{#if totalAdminPushes > 0}
						<p class="text-xs text-muted-foreground">관리자 푸시 {totalAdminPushes}회</p>
					{/if}
				</div>
				{#if summary.pauseCount > 0}
					<div class="rounded-lg border p-3">
						<p class="text-xs text-muted-foreground">일시정지</p>
						<p class="font-mono text-lg font-semibold tabular-nums">{summary.pauseCount}회</p>
						<p class="text-xs text-muted-foreground">총 {fmt(summary.totalPausedMs)}</p>
					</div>
				{/if}
			</div>

			{#if phaseRows.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-sm font-medium">페이즈별 소요 시간</p>
					{#if barTotalMs > 0}
						<div class="flex h-3 w-full overflow-hidden rounded-full">
							{#each phaseRows as row, index (row.phaseId ?? '')}
								<div
									class="min-w-1.5 {RAMP[index % RAMP.length]}"
									style="width: {(row.activeMs / barTotalMs) * 100}%"
								></div>
							{/each}
						</div>
					{/if}
					<ul class="flex flex-col gap-1">
						{#each phaseRows as row, index (row.phaseId ?? '')}
							<li class="flex items-center gap-2 text-sm">
								<span class="size-2.5 shrink-0 rounded-sm {RAMP[index % RAMP.length]}"></span>
								<span class="truncate">{phaseName(row.phaseId)}</span>
								{#if row.entries > 1}
									<span class="shrink-0 text-xs text-muted-foreground">({row.entries}회 진입)</span>
								{/if}
								<span class="ml-auto font-mono tabular-nums">{fmt(row.activeMs)}</span>
								{#if row.wallMs !== row.activeMs}
									<span class="text-xs text-muted-foreground">(전체 {fmt(row.wallMs)})</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if summary.hints.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-sm font-medium">힌트 사용 내역</p>
					<ul class="flex flex-col gap-1">
						{#each summary.hints as hint (hint.hintId)}
							<li class="flex items-center gap-2 text-sm">
								<span class="truncate">{hintName(hint.hintId, hint.code)}</span>
								<span class="ml-auto shrink-0 text-xs text-muted-foreground">
									<!-- The answer is logged as step stepCount, so it caps maxStep. -->
									표시 {hint.shows}회 · 최대 {hint.answerShows > 0
										? '정답'
										: `${hint.maxStep + 1}단계`}{hint.adminPushes > 0
										? ` · 관리자 푸시 ${hint.adminPushes}회`
										: ''}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if interventions.length > 0}
				<p class="text-xs text-muted-foreground">운영 개입: {interventions.join(' · ')}</p>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
