<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import { SvelteSet } from 'svelte/reactivity';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { ConsoleError, parseConsole } from './console.js';
	import { useSessionUi } from './context.js';

	const { model, actions } = useSessionUi();
	const expanded = new SvelteSet<number>();
	let kindFilter = $state('');
	let input = $state('');
	let consoleLines = $state<Array<{ id: number; text: string; error: boolean }>>([]);
	let sequence = 0;

	const kinds = $derived([...new Set(model.logs.map((entry) => entry.kind))].sort());
	const filtered = $derived(
		kindFilter ? model.logs.filter((entry) => entry.kind === kindFilter) : model.logs
	);

	function timeOf(at: Date): string {
		return at.toLocaleTimeString('ko-KR', { hour12: false });
	}

	function toggle(id: number): void {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	function add(text: string, error = false): void {
		consoleLines = [...consoleLines, { id: sequence++, text, error }].slice(-100);
	}

	async function submit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const value = input.trim();
		if (!value) return;
		input = '';
		add(`> ${value}`);
		try {
			const result = parseConsole(value, model.assets);
			for (const line of result.output) add(line);
			if (result.command) await actions.runCommand(result.command);
		} catch (error) {
			add(
				error instanceof ConsoleError || error instanceof Error
					? error.message
					: '명령을 실행하지 못했습니다.',
				true
			);
		}
	}
</script>

<Card.Root class="md:col-span-2">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ScrollTextIcon />로그와 명령 콘솔
			<Badge variant="secondary">{model.logs.length}</Badge>
		</Card.Title>
		<Card.Description
			>서버 로그를 필터링하고 동일한 세션에 일회성 명령을 실행합니다.</Card.Description
		>
		<Card.Action>
			<Select.Root type="single" bind:value={kindFilter}>
				<Select.Trigger size="sm">{kindFilter || '전체'}</Select.Trigger>
				<Select.Content>
					<Select.Group>
						<Select.Item value="" label="전체">전체</Select.Item>
						{#each kinds as kind (kind)}
							<Select.Item value={kind} label={kind}>{kind}</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-2">
		<div
			class="flex max-h-80 min-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border p-2 font-mono text-xs"
		>
			{#if model.logsLoading}
				<p class="text-muted-foreground">로그를 불러오는 중…</p>
			{:else if filtered.length === 0 && consoleLines.length === 0}
				<p class="text-muted-foreground">로그가 없습니다.</p>
			{/if}
			{#each filtered as entry (entry.id)}
				<div class={cn(entry.level === 'error' ? 'text-destructive' : 'text-foreground')}>
					<div class="flex items-start gap-2">
						<span class="shrink-0 text-muted-foreground">{timeOf(entry.at)}</span>
						<Badge variant="outline">{entry.kind}</Badge>
						<span class="min-w-0 break-all">{entry.message}</span>
						{#if entry.data != null}
							<button
								type="button"
								class="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground"
								onclick={() => toggle(entry.id)}
							>
								{#if expanded.has(entry.id)}<ChevronDownIcon
										class="size-3"
									/>{:else}<ChevronRightIcon class="size-3" />{/if}
								data
							</button>
						{/if}
					</div>
					{#if entry.data != null && expanded.has(entry.id)}
						<pre class="mt-1 overflow-x-auto rounded bg-muted p-2 text-foreground">{JSON.stringify(
								entry.data,
								null,
								2
							)}</pre>
					{/if}
				</div>
			{/each}
			{#each consoleLines as line (line.id)}
				<p
					class={cn(
						'whitespace-pre-wrap',
						line.error ? 'text-destructive' : 'text-muted-foreground'
					)}
				>
					{line.text}
				</p>
			{/each}
		</div>
		<form onsubmit={submit}>
			<Input bind:value={input} placeholder="명령 입력 — help로 목록 확인" aria-label="세션 명령" />
		</form>
	</Card.Content>
</Card.Root>
