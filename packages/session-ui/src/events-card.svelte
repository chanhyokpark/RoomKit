<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SkipForwardIcon from '@lucide/svelte/icons/skip-forward';
	import XIcon from '@lucide/svelte/icons/x';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Empty from '$lib/components/ui/empty';
	import { cn } from '$lib/utils';
	import { assetName, assetsOf, commandLabel } from './assets.js';
	import { useSessionUi } from './context.js';
	import type { EventAsset } from './types.js';

	const { model, actions, view } = useSessionUi();
	const expanded = new SvelteSet<string>();
	const busyEvents = new SvelteSet<string>();
	const busyRuns = new SvelteSet<string>();
	/** Events of phases other than the current one are noise most of the time. */
	let showOtherPhases = $state(false);

	const session = $derived(model.session);
	const events = $derived(assetsOf(model.assets, 'event'));
	const runs = $derived(model.runs);
	const canRun = $derived(!!session && session.state !== 'created' && session.state !== 'ended');

	const currentPhaseEvents = $derived(
		events.filter(
			(event) => event.data.phaseId !== null && event.data.phaseId === (session?.phaseId ?? null)
		)
	);
	const commonEvents = $derived(events.filter((event) => event.data.phaseId === null));
	const otherPhaseEvents = $derived(
		events.filter(
			(event) => event.data.phaseId !== null && event.data.phaseId !== (session?.phaseId ?? null)
		)
	);
	/** Events the theme author marked for operator use — offered as one-click buttons. */
	const quickEvents = $derived(
		[...currentPhaseEvents, ...commonEvents].filter((event) => event.data.manualTriggerable)
	);
	const groups = $derived(
		[
			{ label: '현재 페이즈', items: currentPhaseEvents },
			{ label: '공통', items: commonEvents },
			...(showOtherPhases ? [{ label: '다른 페이즈', items: otherPhaseEvents }] : [])
		].filter((group) => group.items.length > 0)
	);

	function toggle(eventId: string): void {
		if (expanded.has(eventId)) expanded.delete(eventId);
		else expanded.add(eventId);
	}

	function runsOf(eventId: string) {
		return runs.filter((run) => run.eventId === eventId);
	}

	function triggerLabel(event: EventAsset): string {
		if (event.data.triggerKind === 'manual') return '수동';
		if (event.data.triggerKind === 'system') return event.data.triggerName ?? 'system';
		return `트리거: ${event.data.triggerName ?? '?'}`;
	}

	async function trigger(eventId: string): Promise<void> {
		if (busyEvents.has(eventId)) return;
		busyEvents.add(eventId);
		try {
			await actions.triggerEvent(eventId);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '이벤트를 실행하지 못했습니다.');
		} finally {
			busyEvents.delete(eventId);
		}
	}

	async function runAction(
		runId: string,
		action: () => Promise<void>,
		failure: string
	): Promise<void> {
		if (busyRuns.has(runId)) return;
		busyRuns.add(runId);
		try {
			await action();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : failure);
		} finally {
			busyRuns.delete(runId);
		}
	}

	const abort = (runId: string) =>
		runAction(runId, () => actions.abortRun(runId), '실행을 중단하지 못했습니다.');
	const skip = (runId: string) =>
		runAction(runId, () => actions.skipRun(runId), '단계를 건너뛰지 못했습니다.');
</script>

{#if view.simple}
	<!-- Simple mode: only the events the theme author marked for operators, as buttons. -->
	{#if quickEvents.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2"><ZapIcon />이벤트</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-wrap gap-1.5">
				{#each quickEvents as event (event.id)}
					<Button
						size="sm"
						disabled={!canRun || busyEvents.has(event.id)}
						onclick={() => trigger(event.id)}
					>
						<PlayIcon data-icon="inline-start" />{event.name}
					</Button>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}
{:else}
	<Card.Root class="md:col-span-2">
		<Card.Header>
			<Card.Title class="flex items-center gap-2">
				<ZapIcon />
				이벤트
				{#if runs.length > 0}<Badge variant="secondary">{runs.length}개 실행 중</Badge>{/if}
			</Card.Title>
			<Card.Description>
				이벤트를 실행하고 시퀀스 진행 상황을 확인합니다. 실행 중인 단계는 건너뛰거나 중단할 수
				있습니다.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-4">
			{#if runs.length > 0}
				<div class="flex flex-col gap-1.5 rounded-md border p-2">
					{#each runs as run (run.runId)}
						<div class="flex items-center gap-2 text-xs">
							<ActivityIcon class="size-4 text-muted-foreground" />
							<span class="font-medium">{run.eventName}</span>
							<span class="text-muted-foreground">
								{run.entryIndex + 1}/{run.entryCount}{run.commandType
									? ` · ${run.commandType}`
									: ''}
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								class="ml-auto"
								aria-label="현재 단계 건너뛰기"
								title="현재 단계 건너뛰기 (대기 중인 단계를 즉시 끝냅니다)"
								disabled={busyRuns.has(run.runId)}
								onclick={() => skip(run.runId)}
							>
								<SkipForwardIcon />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="이벤트 강제 종료"
								title="이벤트 강제 종료"
								disabled={busyRuns.has(run.runId)}
								onclick={() => abort(run.runId)}
							>
								<XIcon />
							</Button>
						</div>
					{/each}
				</div>
			{/if}

			{#if events.length === 0}
				<Empty.Root>
					<Empty.Header>
						<Empty.Title>이벤트가 없습니다.</Empty.Title>
						<Empty.Description>테마에 이벤트를 추가하면 여기에 표시됩니다.</Empty.Description>
					</Empty.Header>
				</Empty.Root>
			{:else}
				{#if quickEvents.length > 0}
					<div class="flex flex-col gap-1.5">
						<p class="text-xs font-medium text-muted-foreground">빠른 실행</p>
						<div class="flex flex-wrap gap-1.5">
							{#each quickEvents as event (event.id)}
								<Button
									size="sm"
									disabled={!canRun || busyEvents.has(event.id)}
									onclick={() => trigger(event.id)}
								>
									<PlayIcon data-icon="inline-start" />{event.name}
								</Button>
							{/each}
						</div>
					</div>
				{/if}

				{#each groups as group (group.label)}
					<div class="flex flex-col gap-1.5">
						<p class="text-xs font-medium text-muted-foreground">{group.label}</p>
						{#each group.items as event (event.id)}
							<div class="rounded-md border">
								<div class="flex items-center gap-2 px-3 py-2">
									<button
										type="button"
										class="flex min-w-0 items-center gap-1 text-left text-sm"
										onclick={() => toggle(event.id)}
									>
										{#if expanded.has(event.id)}
											<ChevronDownIcon class="size-4 shrink-0 text-muted-foreground" />
										{:else}
											<ChevronRightIcon class="size-4 shrink-0 text-muted-foreground" />
										{/if}
										<span class="truncate">{event.name}</span>
									</button>
									<Badge variant="secondary">{triggerLabel(event)}</Badge>
									{#if group.label === '다른 페이즈'}
										<Badge variant="outline">
											{assetName(model.assets, event.data.phaseId) ?? '(삭제됨)'}
										</Badge>
									{/if}
									{#if runsOf(event.id).length > 0}<Badge variant="outline">실행 중</Badge>{/if}
									<Button
										size="sm"
										variant="outline"
										class="ml-auto"
										disabled={!canRun || busyEvents.has(event.id)}
										onclick={() => trigger(event.id)}
									>
										실행
									</Button>
								</div>
								{#if expanded.has(event.id)}
									<ol class="flex flex-col gap-0.5 border-t px-3 py-2">
										{#if event.data.sequence.length === 0}
											<li class="text-xs text-muted-foreground">빈 시퀀스</li>
										{/if}
										{#each event.data.sequence as entry, index (entry.id)}
											{@const active = runsOf(event.id).some((run) => run.entryIndex === index)}
											<li class="flex items-center gap-2 rounded px-1.5 py-0.5 text-xs">
												<span class="w-5 text-right font-mono text-muted-foreground"
													>{index + 1}</span
												>
												<span class={cn(active ? 'font-medium' : 'text-muted-foreground')}>
													{commandLabel(entry, model.assets)}
												</span>
												{#if active}<Badge variant="outline" class="ml-auto">실행 중</Badge>{/if}
											</li>
										{/each}
									</ol>
								{/if}
							</div>
						{/each}
					</div>
				{/each}

				{#if otherPhaseEvents.length > 0}
					<Button
						variant="ghost"
						size="sm"
						class="self-start text-muted-foreground"
						onclick={() => (showOtherPhases = !showOtherPhases)}
					>
						{#if showOtherPhases}
							<ChevronDownIcon data-icon="inline-start" />다른 페이즈 이벤트 숨기기
						{:else}
							<ChevronRightIcon data-icon="inline-start" />다른 페이즈 이벤트 {otherPhaseEvents.length}개
							보기
						{/if}
					</Button>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
{/if}
