<script lang="ts">
	import type { Asset, SequenceEntry } from '@roomkit/shared';
	import { api, ApiError } from '../../api';
	import { admin } from '../../stores/admin.svelte';
	import { themeAssets } from '../../stores/theme-assets.svelte';

	let { sessionId }: { sessionId: string } = $props();

	let error = $state('');
	let expanded = $state<Record<string, boolean>>({});

	type EventAsset = Extract<Asset, { kind: 'event' }>;

	const events = $derived(themeAssets.events as EventAsset[]);
	const currentPhaseId = $derived(admin.session?.phaseId ?? null);

	const groups = $derived.by(() => {
		const current = events.filter(
			(e) => e.data.phaseId !== null && e.data.phaseId === currentPhaseId
		);
		const common = events.filter((e) => e.data.phaseId === null);
		const other = events.filter(
			(e) => e.data.phaseId !== null && e.data.phaseId !== currentPhaseId
		);
		return [
			{ label: '현재 페이즈', items: current, active: true },
			{ label: '공통', items: common, active: true },
			{ label: '다른 페이즈', items: other, active: false }
		].filter((g) => g.items.length > 0);
	});

	function triggerLabel(event: EventAsset): string {
		const { triggerKind, triggerName } = event.data;
		if (triggerKind === 'manual') return '수동';
		if (triggerKind === 'system') return triggerName ?? 'system';
		return `트리거: ${triggerName ?? '?'}`;
	}

	/** Compact one-line description of a sequence command for the preview. */
	function commandLabel(entry: SequenceEntry): string {
		const name = (id: string | null | undefined) => themeAssets.name(id);
		switch (entry.type) {
			case 'playDialogue':
				return `대사 재생: ${name(entry.dialogueId)}${entry.waitUntilEnd ? ' (대기)' : ''}`;
			case 'stopDialogue':
				return `대사 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
			case 'playBgm':
				return `BGM 재생: ${name(entry.bgmId)}${entry.loop ? ' (반복)' : ''}`;
			case 'stopBgm':
				return `BGM 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
			case 'playSfx':
				return `효과음 재생: ${name(entry.sfxId)}`;
			case 'stopSfx':
				return `효과음 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
			case 'playVideo':
				return `비디오 재생: ${name(entry.videoId)}${entry.waitUntilEnd ? ' (대기)' : ''}`;
			case 'stopVideo':
				return `비디오 정지${entry.allPlayers ? ' (전체)' : `: ${name(entry.playerId)}`}`;
			case 'wait':
				return `대기: ${entry.durationMs / 1000}초`;
			case 'navigate':
				return `이동: ${name(entry.deviceId)} → ${name(entry.websiteId)}`;
			case 'sendMessage':
				return `메시지 전송: ${name(entry.deviceId)} ← ${name(entry.messageId)}`;
			case 'sendWebsiteRequest':
				return `웹 요청: ${entry.method} ${name(entry.websiteId)}${entry.path}`;
			case 'switchPhase':
				return `페이즈 전환: ${name(entry.phaseId)}`;
			case 'callEvent':
				return `이벤트 호출: ${name(entry.eventId)}`;
			case 'resetDevice':
				return `디바이스 리셋: ${name(entry.deviceId)}`;
			case 'resetAllDevices':
				return '디바이스 전체 리셋';
			case 'endTheme':
				return `테마 종료 (${entry.verdict === 'success' ? '성공' : '실패'})`;
			case 'adjustTimer':
				return 'deltaMs' in entry.adjustment
					? `타이머 조정: ${entry.adjustment.deltaMs / 1000}초`
					: `타이머 ${entry.adjustment.action === 'pause' ? '정지' : '재개'}`;
			case 'eval':
				return '스크립트 실행';
			case 'notify':
				return `알림: ${entry.message}`;
			case 'showHintCode':
				return `힌트 코드 표시: ${name(entry.hintId)} @ ${name(entry.deviceId)}`;
			case 'hideHintCode':
				return `힌트 코드 숨김${entry.allDevices ? ' (전체)' : `: ${name(entry.deviceId)}`}`;
		}
	}

	/** Live runs of this event, for the preview's progress highlight. */
	function runsOf(eventId: string) {
		return admin.runs.filter((r) => r.eventId === eventId);
	}

	async function run(eventId: string) {
		error = '';
		try {
			await api(`/sessions/${sessionId}/trigger`, { method: 'POST', body: { eventId } });
		} catch (err) {
			error = err instanceof ApiError ? err.message : '이벤트를 실행하지 못했습니다.';
		}
	}

	async function abort(runId: string) {
		error = '';
		try {
			await api(`/sessions/${sessionId}/runs/${runId}/abort`, { method: 'POST' });
		} catch (err) {
			error = err instanceof ApiError ? err.message : '실행을 중단하지 못했습니다.';
		}
	}
</script>

<section class="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-neutral-300">이벤트</h2>
		{#if admin.runs.length > 0}
			<span class="text-xs text-emerald-400">{admin.runs.length}개 실행 중</span>
		{/if}
	</div>

	{#if admin.runs.length > 0}
		<div class="flex flex-col gap-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/20 p-2">
			{#each admin.runs as run (run.runId)}
				<div class="flex items-center gap-2 text-xs">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
					<span>{run.eventName}</span>
					<span class="text-neutral-500">
						{run.entryIndex + 1}/{run.entryCount}{run.commandType ? ` · ${run.commandType}` : ''}
					</span>
					<button
						class="ml-auto rounded border border-neutral-700 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800"
						onclick={() => void abort(run.runId)}
					>
						중단
					</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if events.length === 0}
		<p class="text-sm text-neutral-500">이 테마에는 이벤트가 없습니다.</p>
	{/if}

	{#each groups as group (group.label)}
		<div class="flex flex-col gap-1.5">
			<h3 class="text-xs font-medium text-neutral-500">{group.label}</h3>
			{#each group.items as event (event.id)}
				<div class="rounded-md border border-neutral-800 bg-neutral-900/80">
					<div class="flex items-center gap-2 px-3 py-2">
						<button
							class="text-left text-sm hover:text-white"
							onclick={() => (expanded[event.id] = !expanded[event.id])}
						>
							<span class="mr-1 text-neutral-500">{expanded[event.id] ? '▾' : '▸'}</span>
							{event.name}
						</button>
						<span class="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-400">
							{triggerLabel(event)}
						</span>
						{#if runsOf(event.id).length > 0}
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
						{/if}
						<button
							class="ml-auto rounded-md bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
							disabled={admin.session?.state !== 'running' && admin.session?.state !== 'paused'}
							onclick={() => void run(event.id)}
						>
							실행
						</button>
					</div>
					{#if expanded[event.id]}
						<ol class="flex flex-col gap-0.5 border-t border-neutral-800 px-3 py-2">
							{#if event.data.sequence.length === 0}
								<p class="text-xs text-neutral-500">빈 시퀀스</p>
							{/if}
							{#each event.data.sequence as entry, i (entry.id)}
								{@const activeRun = runsOf(event.id).find((r) => r.entryIndex === i)}
								<li
									class="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs {activeRun
										? 'bg-emerald-950/40 text-emerald-300'
										: 'text-neutral-400'}"
								>
									<span class="w-5 text-right font-mono text-neutral-600">{i + 1}</span>
									<span>{commandLabel(entry)}</span>
									{#if activeRun}
										<span class="ml-auto animate-pulse text-[10px]">실행 중</span>
									{/if}
								</li>
							{/each}
						</ol>
					{/if}
				</div>
			{/each}
		</div>
	{/each}

	{#if error}
		<p class="text-xs text-red-400">{error}</p>
	{/if}
</section>
