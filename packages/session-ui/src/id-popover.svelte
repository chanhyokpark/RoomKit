<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';
	import { assetName, commandLabel } from './assets.js';
	import { useSessionUi } from './context.js';
	import { channelLabels, formatClock, formatDuration, kindLabels, stripHtml } from './format.js';

	/**
	 * A UUID rendered as a trigger; the popover resolves it against the
	 * dashboard's live model (assets, runs, playing media) and the log buffer.
	 */
	let { id, class: className }: { id: string; class?: string } = $props();

	const { model } = useSessionUi();
	let open = $state(false);

	const asset = $derived(model.assets.find((candidate) => candidate.id === id) ?? null);
	const run = $derived(model.runs.find((candidate) => candidate.runId === id) ?? null);
	const playing = $derived(
		model.media?.playing.find((candidate) => candidate.commandId === id) ?? null
	);
	/** Other log lines mentioning this id — the "command row" for wire ids. Newest first. */
	const related = $derived(
		open
			? model.logs
					.filter((entry) => entry.data != null && JSON.stringify(entry.data).includes(id))
					.slice(-8)
					.toReversed()
			: []
	);

	function deviceLabel(deviceId: string | null | undefined): string {
		if (!deviceId) return '-';
		const device = model.assets.find((a) => a.id === deviceId && a.kind === 'device');
		return device && device.kind === 'device'
			? device.data.displayName || device.name
			: (assetName(model.assets, deviceId) ?? '(삭제됨)');
	}

	/** Label/value pairs for the resolved item. */
	const rows = $derived.by((): Array<[string, string]> => {
		if (asset) {
			switch (asset.kind) {
				case 'device': {
					const status = model.statusOf(asset.id);
					const website = model.media?.websites.find((w) => w.deviceId === asset.id);
					const state = model.media?.states.find((s) => s.deviceId === asset.id);
					const media = model.media?.playing.filter((p) => p.deviceId === asset.id) ?? [];
					return [
						['표시 이름', asset.data.displayName || '-'],
						['연결', status?.online ? '온라인' : '오프라인'],
						['힌트 장치', asset.data.isHintDevice ? '예' : '아니오'],
						['Client', status?.clientVersion ?? '-'],
						['Helper', status?.helperVersion ?? '-'],
						[
							'웹사이트',
							website ? (assetName(model.assets, website.websiteId) ?? website.url) : '-'
						],
						['상태', state ? (assetName(model.assets, state.stateId) ?? state.stateName) : '-'],
						['재생 중', media.length > 0 ? media.map((p) => p.assetName).join(', ') : '-']
					];
				}
				case 'event':
					return [
						[
							'트리거',
							asset.data.triggerKind === 'manual'
								? '수동'
								: `${asset.data.triggerKind}: ${asset.data.triggerName ?? '?'}`
						],
						[
							'페이즈',
							asset.data.phaseId
								? (assetName(model.assets, asset.data.phaseId) ?? '(삭제됨)')
								: '공통'
						],
						['운영자 실행', asset.data.manualTriggerable ? '가능' : '불가'],
						['시퀀스', `${asset.data.sequence.length}단계`],
						['실행 중', String(model.runs.filter((r) => r.eventId === asset.id).length)]
					];
				case 'hint':
					return [
						['코드', asset.code ?? '-'],
						['단계', `${asset.data.steps.length}단계${asset.data.answer ? ' + 정답' : ''}`],
						['1단계', stripHtml(asset.data.steps[0]?.textHtml ?? '') || '-']
					];
				case 'phase':
					return [
						['순서', String(asset.data.order)],
						['진입 시 상태', String(asset.data.deviceStates.length)],
						['진입 시 웹사이트', String(asset.data.deviceWebsites.length)],
						['진입 시 BGM', String(asset.data.playerBgms.length)],
						['현재 페이즈', model.session?.phaseId === asset.id ? '예' : '아니오']
					];
				case 'website':
					return asset.data.mode === 'hosted'
						? [
								['종류', '호스팅'],
								['경로', asset.data.sitePrefix]
							]
						: [
								['종류', '외부'],
								['URL', asset.data.url]
							];
				case 'message':
				case 'state':
					return [
						['표시 이름', asset.data.displayName || '-'],
						[
							'필드',
							asset.data.fields.length > 0
								? asset.data.fields.map((f) => `${f.key}:${f.type}`).join(', ')
								: '없음'
						]
					];
				case 'bgm':
				case 'sfx':
				case 'video':
					return [
						[
							'파일',
							asset.data.fileKey
								? '있음'
								: `없음 (${formatDuration(asset.data.durationMs)} 시뮬레이션)`
						],
						...(asset.kind === 'bgm'
							? [
									['페이드', `in ${asset.data.fadeInMs}ms / out ${asset.data.fadeOutMs}ms`] as [
										string,
										string
									]
								]
							: [])
					];
				case 'dialogue':
					return [
						['라인', `${asset.data.lines.length}줄`],
						['첫 줄', stripHtml(asset.data.lines[0]?.subtitleHtml ?? '') || '-']
					];
				case 'player':
					return [
						['스피커', deviceLabel(asset.data.speakerDeviceId)],
						['화면', deviceLabel(asset.data.screenDeviceId)]
					];
				default:
					return [];
			}
		}
		if (run) {
			return [
				['이벤트', run.eventName],
				[
					'진행',
					`${run.entryIndex + 1}/${run.entryCount}${run.commandType ? ` · ${run.commandType}` : ''}`
				],
				['시작', formatClock(run.startedAt)]
			];
		}
		if (playing) {
			return [
				['채널', channelLabels[playing.channel]],
				['애셋', assetName(model.assets, playing.assetId) ?? playing.assetName],
				['디바이스', deviceLabel(playing.deviceId)],
				['플레이어', assetName(model.assets, playing.playerId) ?? '(삭제됨)'],
				['시작', formatClock(playing.startedAt)],
				...(playing.lineIndex !== null
					? [['대사 라인', String(playing.lineIndex + 1)] as [string, string]]
					: [])
			];
		}
		return [];
	});
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			'cursor-pointer rounded font-mono underline decoration-dotted underline-offset-2 hover:bg-muted hover:text-foreground',
			className
		)}
		title="자세히 보기"
	>
		{id}
	</Popover.Trigger>
	<Popover.Content class="w-80 gap-3 p-3 text-xs" align="start">
		<div class="flex items-center gap-2">
			{#if asset}
				<Badge variant="secondary">{kindLabels[asset.kind]}</Badge>
				<span class="min-w-0 truncate text-sm font-medium">{asset.name}</span>
				{#if asset.code}<code class="text-muted-foreground">{asset.code}</code>{/if}
			{:else if run}
				<Badge variant="secondary">이벤트 실행</Badge>
				<span class="min-w-0 truncate text-sm font-medium">{run.eventName}</span>
			{:else if playing}
				<Badge variant="secondary">재생 중</Badge>
				<span class="min-w-0 truncate text-sm font-medium">{playing.assetName}</span>
			{:else}
				<span class="text-muted-foreground">
					현재 모델에 없는 ID입니다 (끝난 명령이나 삭제된 애셋일 수 있습니다).
				</span>
			{/if}
		</div>
		{#if rows.length > 0}
			<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
				{#each rows as [label, value] (label)}
					<dt class="text-muted-foreground">{label}</dt>
					<dd class="min-w-0 break-all">{value}</dd>
				{/each}
			</dl>
		{/if}
		{#if asset?.kind === 'event' && asset.data.sequence.length > 0}
			<ol class="flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded border p-1.5">
				{#each asset.data.sequence.slice(0, 12) as entry, index (entry.id)}
					<li class="flex gap-2">
						<span class="w-4 shrink-0 text-right font-mono text-muted-foreground">{index + 1}</span>
						<span class="min-w-0 truncate">{commandLabel(entry, model.assets)}</span>
					</li>
				{/each}
				{#if asset.data.sequence.length > 12}
					<li class="text-muted-foreground">… 외 {asset.data.sequence.length - 12}단계</li>
				{/if}
			</ol>
		{/if}
		{#if related.length > 0}
			<div class="flex flex-col gap-1">
				<p class="font-medium text-muted-foreground">관련 로그</p>
				<ul class="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
					{#each related as entry (entry.id)}
						<li
							class={cn('flex items-start gap-1.5', entry.level === 'error' && 'text-destructive')}
						>
							<span class="shrink-0 font-mono text-muted-foreground">
								{entry.at.toLocaleTimeString('ko-KR', { hour12: false })}
							</span>
							<Badge variant="outline" class="shrink-0">{entry.kind}</Badge>
							<span class="min-w-0 break-all">{entry.message}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<p class="font-mono text-[10px] break-all text-muted-foreground">{id}</p>
	</Popover.Content>
</Popover.Root>
