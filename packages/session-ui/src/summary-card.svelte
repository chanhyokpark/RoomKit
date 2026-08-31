<script lang="ts">
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Spinner } from '$lib/components/ui/spinner';
	import type { SessionSummary } from '@roomkit/shared';
	import { assetName } from './assets.js';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model, actions } = useSessionUi();
	let summary = $state<SessionSummary | null>(null);
	let loading = $state(true);
	let failed = $state(false);

	const phaseRows = $derived.by(() => {
		if (!summary) return [];
		const order = new Map(assetsOf(model.assets, 'phase').map((phase, index) => [phase.id, index]));
		return summary.phases.toSorted(
			(a, b) =>
				(order.get(a.phaseId ?? '') ?? Number.MAX_SAFE_INTEGER) -
				(order.get(b.phaseId ?? '') ?? Number.MAX_SAFE_INTEGER)
		);
	});
	const totalHints = $derived(summary?.hints.reduce((sum, hint) => sum + hint.shows, 0) ?? 0);
	const distinctHints = $derived(summary?.hints.filter((hint) => hint.shows > 0).length ?? 0);
	const totalAdminPushes = $derived(
		summary?.hints.reduce((sum, hint) => sum + hint.adminPushes, 0) ?? 0
	);
	const interventions = $derived.by(() => {
		if (!summary) return [];
		const items: string[] = [];
		if (summary.phaseRestartCount > 0) items.push(`페이즈 재시작 ${summary.phaseRestartCount}회`);
		if ((summary.timer?.adjustmentCount ?? 0) > 0) {
			items.push(`타이머 조정 ${summary.timer!.adjustmentCount}회`);
		}
		return items;
	});

	async function load(): Promise<void> {
		loading = true;
		failed = false;
		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				summary = await actions.getSummary();
				loading = false;
				return;
			} catch {
				// The ended broadcast can arrive just before the durable row update.
				if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 750));
			}
		}
		failed = true;
		loading = false;
	}

	$effect(() => {
		void model.sessionId;
		void load();
	});

	function fmt(ms: number): string {
		const total = Math.round(ms / 1000);
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		return h > 0
			? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
			: `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}
</script>

<Card.Root class="md:col-span-2">
	<Card.Header>
		<Card.Title class="flex items-center gap-2"><ChartColumnIcon />세션 결과</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if loading}
			<div class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
				<Spinner /> 결과를 불러오는 중…
			</div>
		{:else if failed || !summary}
			<div class="flex items-center justify-center gap-2 py-6">
				<p class="text-sm text-muted-foreground">세션 결과를 불러오지 못했습니다.</p>
				<Button size="sm" variant="outline" onclick={load}>다시 시도</Button>
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
				<div class="rounded-md border p-3">
					<p class="text-xs text-muted-foreground">판정</p>
					<p class="font-medium">
						{summary.verdict === 'success' ? '성공' : summary.verdict === 'fail' ? '실패' : '없음'}
					</p>
				</div>
				<div class="rounded-md border p-3">
					<p class="text-xs text-muted-foreground">플레이 시간</p>
					<p class="font-mono font-medium tabular-nums">
						{fmt(summary.totalActiveMs)}
					</p>
					{#if summary.totalWallMs !== summary.totalActiveMs}
						<p class="text-xs text-muted-foreground">전체 {fmt(summary.totalWallMs)}</p>
					{/if}
				</div>
				{#if summary.timer}
					<div class="rounded-md border p-3">
						<p class="text-xs text-muted-foreground">남은 시간</p>
						<p class="font-mono font-medium tabular-nums">
							{summary.timer.expired
								? '시간 초과'
								: summary.timer.remainingMsAtEnd !== null
									? fmt(summary.timer.remainingMsAtEnd)
									: '—'}
						</p>
						{#if summary.timer.timeLimitMs !== null}
							<p class="text-xs text-muted-foreground">제한 {fmt(summary.timer.timeLimitMs)}</p>
						{/if}
					</div>
				{/if}
				<div class="rounded-md border p-3">
					<p class="text-xs text-muted-foreground">힌트 사용</p>
					<p class="font-medium">{totalHints}회(중복 제외 {distinctHints}회)</p>
					{#if totalAdminPushes > 0}
						<p class="text-xs text-muted-foreground">관리자 푸시 {totalAdminPushes}회</p>
					{/if}
				</div>
				{#if summary.pauseCount > 0}
					<div class="rounded-md border p-3">
						<p class="text-xs text-muted-foreground">일시정지</p>
						<p class="font-medium">
							{summary.pauseCount}회 · {fmt(summary.totalPausedMs)}
						</p>
					</div>
				{/if}
			</div>
			{#if phaseRows.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-sm font-medium">페이즈별 활성 시간</p>
					{#each phaseRows as phase (phase.phaseId ?? 'none')}
						<div class="flex items-center gap-2 text-sm">
							<span
								>{phase.phaseId
									? (assetName(model.assets, phase.phaseId) ?? '(삭제됨)')
									: '공통'}</span
							>
							<span class="ml-auto font-mono tabular-nums">{fmt(phase.activeMs)}</span>
							{#if phase.entries > 1}
								<span class="text-xs text-muted-foreground">{phase.entries}회 진입</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#if summary.hints.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-sm font-medium">힌트 사용 내역</p>
					{#each summary.hints as hint (hint.hintId)}
						<div class="flex items-center gap-2 text-sm">
							<span>{assetName(model.assets, hint.hintId) ?? hint.code ?? '(삭제됨)'}</span>
							<span class="ml-auto text-xs text-muted-foreground">
								표시 {hint.shows}회 · 최대 {hint.answerShows > 0
									? '정답'
									: `${hint.maxStep + 1}단계`}{hint.adminPushes > 0
									? ` · 관리자 푸시 ${hint.adminPushes}회`
									: ''}
							</span>
						</div>
					{/each}
				</div>
			{/if}
			{#if interventions.length > 0}
				<p class="text-xs text-muted-foreground">운영 개입: {interventions.join(' · ')}</p>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
