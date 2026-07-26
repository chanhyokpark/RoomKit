<script lang="ts">
	import ActivityIcon from '@lucide/svelte/icons/activity';
	import XIcon from '@lucide/svelte/icons/x';
	import { SvelteSet } from 'svelte/reactivity';
	import type { CommandType } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { COMMAND_META } from '$lib/components/editor/commands/registry';
	import { abortRun } from '$lib/api/sessions';
	import { toastApiError } from '$lib/api/client';
	import { useOperationData, type SessionView } from './operation-data.svelte';

	let { session }: { session: SessionView } = $props();

	const data = useOperationData();

	const runs = $derived(data.runsFor(session.id));
	/** Run ids with a terminate request in flight (cleared by the runs snapshot). */
	const terminating = new SvelteSet<string>();

	function commandLabel(type: string | null): string {
		if (type === null) return '빈 시퀀스';
		return COMMAND_META[type as CommandType]?.label ?? type;
	}

	async function terminate(runId: string): Promise<void> {
		if (terminating.has(runId)) return;
		terminating.add(runId);
		try {
			await abortRun(session.id, runId);
		} catch (err) {
			toastApiError(err, '이벤트를 종료하지 못했습니다.');
			terminating.delete(runId);
		}
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
						<Button
							variant="ghost"
							size="icon"
							class="size-6 shrink-0 text-muted-foreground hover:text-destructive"
							aria-label="이벤트 강제 종료"
							title="이벤트 강제 종료"
							disabled={terminating.has(run.runId)}
							onclick={() => terminate(run.runId)}
						>
							<XIcon />
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
