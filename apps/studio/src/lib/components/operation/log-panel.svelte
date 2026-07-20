<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { useOperationData } from './operation-data.svelte';

	// Logs are keyed to the selected session inside OperationData.
	const data = useOperationData();

	const kindLabels: Record<string, string> = {
		session: '세션',
		phase: '페이즈',
		timer: '타이머',
		trigger: '트리거',
		event: '이벤트',
		command: '커맨드',
		eval: 'eval',
		device: '디바이스',
		hint: '힌트'
	};

	let container = $state<HTMLDivElement | null>(null);
	let stickToBottom = $state(true);

	function handleScroll(): void {
		if (!container) return;
		const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
		stickToBottom = distance < 40;
	}

	function scrollToBottom(): void {
		if (container) container.scrollTop = container.scrollHeight;
		stickToBottom = true;
	}

	$effect(() => {
		void data.logs.length;
		if (stickToBottom && container) container.scrollTop = container.scrollHeight;
	});

	function timeLabel(at: Date): string {
		return at.toLocaleTimeString('ko-KR', {
			hour12: false,
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}
</script>

<Card.Root class="flex min-h-64 flex-col">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ScrollTextIcon class="size-4" />
			로그
		</Card.Title>
	</Card.Header>
	<Card.Content class="relative flex min-h-0 flex-1 flex-col">
		{#if data.logsLoading}
			<div class="flex flex-col gap-2">
				<Skeleton class="h-5 w-full" />
				<Skeleton class="h-5 w-full" />
				<Skeleton class="h-5 w-2/3" />
			</div>
		{:else if data.logs.length === 0}
			<p class="py-6 text-center text-sm text-muted-foreground">로그가 없습니다.</p>
		{:else}
			<div
				bind:this={container}
				onscroll={handleScroll}
				class="flex max-h-96 min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto font-mono text-xs"
			>
				{#each data.logs as entry (entry.id)}
					<div
						class="flex items-start gap-2 rounded px-1 py-0.5 {entry.level === 'error'
							? 'text-destructive'
							: entry.level === 'warn'
								? 'text-amber-600 dark:text-amber-400'
								: ''}"
					>
						<span class="shrink-0 text-muted-foreground">{timeLabel(entry.at)}</span>
						<Badge variant="outline" class="shrink-0 px-1 py-0 text-[10px]">
							{kindLabels[entry.kind] ?? entry.kind}
						</Badge>
						<span class="min-w-0 break-all">{entry.message}</span>
						{#if entry.data != null}
							<details class="ml-auto shrink-0">
								<summary class="cursor-pointer text-muted-foreground select-none">…</summary>
								<pre class="max-w-64 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(
										entry.data,
										null,
										1
									)}</pre>
							</details>
						{/if}
					</div>
				{/each}
			</div>
			{#if !stickToBottom}
				<Button
					size="sm"
					variant="secondary"
					class="absolute bottom-3 left-1/2 -translate-x-1/2 shadow"
					onclick={scrollToBottom}
				>
					<ArrowDownIcon data-icon="inline-start" />
					맨 아래로
				</Button>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
