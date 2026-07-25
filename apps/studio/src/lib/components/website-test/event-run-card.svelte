<script lang="ts">
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import type { EventAsset } from '$lib/components/editor/editor-data.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Spinner } from '$lib/components/ui/spinner';
	import { useWebsiteTestData } from './website-test-data.svelte';

	const data = useWebsiteTestData();

	interface EventGroup {
		label: string;
		phaseId: string | null;
		events: EventAsset[];
	}

	const groups = $derived.by<EventGroup[]>(() => {
		const sorted = (events: EventAsset[]) =>
			events.toSorted((a, b) => a.name.localeCompare(b.name));
		const result: EventGroup[] = [
			{
				label: '공통',
				phaseId: null,
				events: sorted(data.events.filter((e) => e.data.phaseId === null))
			}
		];
		for (const phase of data.phases) {
			result.push({
				label: phase.name,
				phaseId: phase.id,
				events: sorted(data.events.filter((e) => e.data.phaseId === phase.id))
			});
		}
		return result.filter((group) => group.events.length > 0);
	});

	function triggerLabel(event: EventAsset): string {
		switch (event.data.triggerKind) {
			case 'device':
				return `트리거: ${event.data.triggerName || '(없음)'}`;
			case 'system':
				return `시스템: ${event.data.triggerName || '(없음)'}`;
			default:
				return '수동';
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ZapIcon class="size-4" />
			이벤트 실행
		</Card.Title>
		<Card.Description>
			이벤트 시퀀스를 실행합니다. 테스트 장치 외의 장치/플레이어 대상 커맨드와 페이즈 전환 등 흐름
			커맨드는 건너뛰고 로그에 표시됩니다.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if data.runningEvent}
			<div class="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
				<Spinner class="size-4" />
				<span class="min-w-0 truncate">"{data.runningEvent.eventName}" 실행 중…</span>
				<Button class="ml-auto" size="sm" variant="outline" onclick={() => data.cancelEventRun()}>
					<SquareIcon data-icon="inline-start" />
					중단
				</Button>
			</div>
		{/if}
		{#if groups.length === 0}
			<p class="text-sm text-muted-foreground">테마에 이벤트가 없습니다.</p>
		{:else}
			{#each groups as group (group.label)}
				<div class="flex flex-col gap-1">
					<span class="text-xs font-medium text-muted-foreground">{group.label}</span>
					{#each group.events as event (event.id)}
						{@const outsidePhase =
							event.data.phaseId !== null && event.data.phaseId !== data.run?.phaseId}
						<div class="flex items-center gap-2 rounded-md border px-2 py-1.5">
							<span class="min-w-0 flex-1 truncate text-sm {outsidePhase ? 'opacity-60' : ''}">
								{event.name}
							</span>
							<Badge variant="outline" class="shrink-0 text-[10px]">{triggerLabel(event)}</Badge>
							{#if outsidePhase}
								<Badge variant="secondary" class="shrink-0 text-[10px]">다른 페이즈</Badge>
							{/if}
							<Button
								size="sm"
								variant="ghost"
								aria-label="이벤트 실행"
								disabled={data.runningEvent !== null}
								onclick={() => data.runEvent(event.id)}
							>
								<PlayIcon />
							</Button>
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</Card.Content>
</Card.Root>
