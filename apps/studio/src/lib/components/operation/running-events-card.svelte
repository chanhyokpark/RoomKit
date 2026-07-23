<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import type { CommandType } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { COMMAND_META } from '$lib/components/editor/commands/registry';
	import { useOperationData, type SessionView } from './operation-data.svelte';

	let { session }: { session: SessionView } = $props();

	const data = useOperationData();

	const runs = $derived(data.runsFor(session.id));

	function commandLabel(type: string | null): string {
		if (type === null) return '빈 시퀀스';
		return COMMAND_META[type as CommandType]?.label ?? type;
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ActivityIcon class="size-4" />
			실행 중 이벤트
			{#if runs.length > 0}
				<Badge variant="secondary">{runs.length}</Badge>
			{/if}
		</Card.Title>
	</Card.Header>
	<Card.Content>
		{#if runs.length === 0}
			<p class="text-sm text-muted-foreground">실행 중인 이벤트가 없습니다.</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each runs as run (run.runId)}
					<li class="flex items-center gap-2 text-sm">
						<span class="relative flex size-2 shrink-0">
							<span
								class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"
							></span>
							<span class="relative inline-flex size-2 rounded-full bg-emerald-500"></span>
						</span>
						<span class="truncate font-medium">{run.eventName}</span>
						<span class="ml-auto shrink-0 text-xs text-muted-foreground">
							{run.entryIndex + 1}/{run.entryCount} · {commandLabel(run.commandType)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
