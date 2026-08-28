<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import XIcon from '@lucide/svelte/icons/x';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Empty from '$lib/components/ui/empty';
	import { cn } from '$lib/utils';
	import { assetsOf, commandLabel } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model, actions } = useSessionUi();
	const expanded = new SvelteSet<string>();
	const busyEvents = new SvelteSet<string>();
	const aborting = new SvelteSet<string>();

	const session = $derived(model.session);
	const events = $derived(assetsOf(model.assets, 'event'));
	const runs = $derived(model.runs);
	const groups = $derived.by(() => {
		const phaseId = session?.phaseId ?? null;
		return [
			{
				label: '현재 페이즈',
				items: events.filter(
					(event) => event.data.phaseId !== null && event.data.phaseId === phaseId
				),
				active: true
			},
			{
				label: '공통',
				items: events.filter((event) => event.data.phaseId === null),
				active: true
			},
			{
				label: '다른 페이즈',
				items: events.filter(
					(event) => event.data.phaseId !== null && event.data.phaseId !== phaseId
				),
				active: false
			}
		].filter((group) => group.items.length > 0);
	});

	function toggle(eventId: string): void {
		if (expanded.has(eventId)) expanded.delete(eventId);
		else expanded.add(eventId);
	}

	function runsOf(eventId: string) {
		return runs.filter((run) => run.eventId === eventId);
	}

	function triggerLabel(event: (typeof events)[number]): string {
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

	async function abort(runId: string): Promise<void> {
		if (aborting.has(runId)) return;
		aborting.add(runId);
		try {
			await actions.abortRun(runId);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '실행을 중단하지 못했습니다.');
			aborting.delete(runId);
		}
	}
</script>

<Card.Root class="md:col-span-2">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ZapIcon />
			이벤트
			{#if runs.length > 0}<Badge variant="secondary">{runs.length}개 실행 중</Badge>{/if}
		</Card.Title>
		<Card.Description>수동 이벤트를 실행하고 시퀀스 진행 상황을 확인합니다.</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if runs.length > 0}
			<div class="flex flex-col gap-1.5 rounded-md border p-2">
				{#each runs as run (run.runId)}
					<div class="flex items-center gap-2 text-xs">
						<ActivityIcon class="size-4 text-muted-foreground" />
						<span class="font-medium">{run.eventName}</span>
						<span class="text-muted-foreground">
							{run.entryIndex + 1}/{run.entryCount}{run.commandType ? ` · ${run.commandType}` : ''}
						</span>
						<Button
							variant="ghost"
							size="icon-sm"
							class="ml-auto"
							aria-label="이벤트 강제 종료"
							disabled={aborting.has(run.runId)}
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
								{#if runsOf(event.id).length > 0}<Badge variant="outline">실행 중</Badge>{/if}
								<Button
									size="sm"
									variant="outline"
									class="ml-auto"
									disabled={!group.active ||
										!event.data.manualTriggerable ||
										busyEvents.has(event.id) ||
										!session ||
										session.state === 'created' ||
										session.state === 'ended'}
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
											<span class="w-5 text-right font-mono text-muted-foreground">{index + 1}</span
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
		{/if}
	</Card.Content>
</Card.Root>
