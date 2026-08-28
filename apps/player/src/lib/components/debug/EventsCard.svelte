<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Asset, SequenceEntry } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
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

<Card.Root>
	<Card.Header>
		<Card.Title>이벤트</Card.Title>
		{#if admin.runs.length > 0}
			<Card.Action>
				<span class="text-xs text-emerald-400">{admin.runs.length}개 실행 중</span>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if admin.runs.length > 0}
			<div class="flex flex-col gap-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/20 p-2">
				{#each admin.runs as run (run.runId)}
					<div class="flex items-center gap-2 text-xs">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
						<span>{run.eventName}</span>
						<span class="text-muted-foreground">
							{run.entryIndex + 1}/{run.entryCount}{run.commandType ? ` · ${run.commandType}` : ''}
						</span>
						<Button
							variant="outline"
							size="sm"
							class="ml-auto"
							onclick={() => void abort(run.runId)}
						>
							중단
						</Button>
					</div>
				{/each}
			</div>
		{/if}

		{#if events.length === 0}
			<p class="text-sm text-muted-foreground">이 테마에는 이벤트가 없습니다.</p>
		{/if}

		{#each groups as group (group.label)}
			<div class="flex flex-col gap-1.5">
				<h3 class="text-xs font-medium text-muted-foreground">{group.label}</h3>
				{#each group.items as event (event.id)}
					<div class="rounded-md border bg-card">
						<div class="flex items-center gap-2 px-3 py-2">
							<button
								class="flex items-center gap-1 text-left text-sm hover:text-foreground"
								onclick={() => (expanded[event.id] = !expanded[event.id])}
							>
								{#if expanded[event.id]}
									<ChevronDownIcon class="size-4 text-muted-foreground" />
								{:else}
									<ChevronRightIcon class="size-4 text-muted-foreground" />
								{/if}
								{event.name}
							</button>
							<Badge variant="secondary" class="text-[11px]">{triggerLabel(event)}</Badge>
							{#if runsOf(event.id).length > 0}
								<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"></span>
							{/if}
							<Button
								size="sm"
								class="ml-auto"
								disabled={admin.session?.state !== 'running' && admin.session?.state !== 'paused'}
								onclick={() => void run(event.id)}
							>
								실행
							</Button>
						</div>
						{#if expanded[event.id]}
							<ol class="flex flex-col gap-0.5 border-t px-3 py-2">
								{#if event.data.sequence.length === 0}
									<p class="text-xs text-muted-foreground">빈 시퀀스</p>
								{/if}
								{#each event.data.sequence as entry, i (entry.id)}
									{@const activeRun = runsOf(event.id).find((r) => r.entryIndex === i)}
									<li
										class="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs {activeRun
											? 'bg-emerald-950/40 text-emerald-300'
											: 'text-muted-foreground'}"
									>
										<span class="w-5 text-right font-mono text-muted-foreground/60">{i + 1}</span>
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
			<p class="text-xs text-destructive">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>
