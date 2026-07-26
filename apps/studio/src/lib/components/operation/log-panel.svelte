<!-- Bottom log panel, foldable like the VS Code terminal. -->
<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ScrollTextIcon from '@lucide/svelte/icons/scroll-text';
	import { SvelteSet } from 'svelte/reactivity';
	import type { SessionLogEntry } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { runSessionCommand } from '$lib/api/sessions';
	import { useOperationData } from './operation-data.svelte';
	import { ConsoleError, parseConsole } from './console';
	import JsonView from './json-view.svelte';

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

	let open = $state(true);
	let container = $state<HTMLDivElement | null>(null);
	let stickToBottom = $state(true);
	/** Log entry ids whose data tree is expanded. */
	const expanded = new SvelteSet<number>();

	/** Local console echo/output, interleaved with server logs by time. */
	interface ConsoleEntry {
		id: number;
		at: Date;
		text: string;
		kind: 'input' | 'output' | 'error';
	}
	let consoleEntries = $state<ConsoleEntry[]>([]);
	let consoleSeq = 0;
	let commandInput = $state('');
	let history: string[] = [];
	let historyIndex = -1;
	/** Draft stashed while browsing history with the arrow keys. */
	let historyDraft = '';

	/** One display row: a server log entry or a local console line. */
	interface Row {
		key: string;
		log?: SessionLogEntry;
		console?: ConsoleEntry;
	}

	// Both sources are time-ascending; merge keeps the interleaved order stable.
	const rows = $derived.by<Row[]>(() => {
		const logs = data.logs;
		const cons = consoleEntries;
		const merged: Row[] = [];
		let i = 0;
		let j = 0;
		while (i < logs.length || j < cons.length) {
			const takeLog =
				j >= cons.length || (i < logs.length && logs[i].at.getTime() <= cons[j].at.getTime());
			if (takeLog) {
				merged.push({ key: `s${logs[i].id}`, log: logs[i] });
				i++;
			} else {
				merged.push({ key: `c${cons[j].id}`, console: cons[j] });
				j++;
			}
		}
		return merged;
	});

	function handleScroll(): void {
		if (!container) return;
		const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
		stickToBottom = distance < 40;
	}

	function scrollToBottom(): void {
		if (container) container.scrollTop = container.scrollHeight;
		stickToBottom = true;
	}

	function toggleData(id: number): void {
		if (expanded.has(id)) expanded.delete(id);
		else expanded.add(id);
	}

	$effect(() => {
		void rows.length;
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

	function pushConsole(kind: ConsoleEntry['kind'], text: string): void {
		consoleEntries = [...consoleEntries, { id: consoleSeq++, at: new Date(), text, kind }];
	}

	async function submitCommand(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const input = commandInput.trim();
		if (!input) return;
		const sessionId = data.selectedSessionId;
		if (!sessionId) return;
		commandInput = '';
		if (history.at(-1) !== input) history.push(input);
		historyIndex = -1;
		pushConsole('input', `> ${input}`);
		try {
			const result = parseConsole(input, data, sessionId);
			for (const line of result.output) pushConsole('output', line);
			// Session commands echo their outcome through the server log stream.
			if (result.command) await runSessionCommand(sessionId, result.command);
		} catch (err) {
			pushConsole(
				'error',
				err instanceof ConsoleError || err instanceof Error
					? err.message
					: '명령 실행에 실패했습니다.'
			);
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowUp') {
			if (history.length === 0) return;
			event.preventDefault();
			if (historyIndex === -1) {
				historyDraft = commandInput;
				historyIndex = history.length - 1;
			} else if (historyIndex > 0) {
				historyIndex--;
			}
			commandInput = history[historyIndex];
		} else if (event.key === 'ArrowDown') {
			if (historyIndex === -1) return;
			event.preventDefault();
			if (historyIndex < history.length - 1) {
				historyIndex++;
				commandInput = history[historyIndex];
			} else {
				historyIndex = -1;
				commandInput = historyDraft;
			}
		}
	}
</script>

<div class="flex shrink-0 flex-col border-t bg-background">
	<button
		type="button"
		class="flex w-full items-center gap-2 px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
		onclick={() => (open = !open)}
		aria-expanded={open}
	>
		<ScrollTextIcon class="size-4" />
		로그
		{#if data.logs.length > 0}
			<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">{data.logs.length}</Badge>
		{/if}
		<span class="ml-auto text-muted-foreground">
			{#if open}
				<ChevronDownIcon class="size-4" />
			{:else}
				<ChevronUpIcon class="size-4" />
			{/if}
		</span>
	</button>
	{#if open}
		<div class="relative flex h-56 flex-col border-t md:h-64">
			{#if data.logsLoading}
				<div class="flex flex-col gap-2 p-3">
					<Skeleton class="h-5 w-full" />
					<Skeleton class="h-5 w-full" />
					<Skeleton class="h-5 w-2/3" />
				</div>
			{:else}
				<div
					bind:this={container}
					onscroll={handleScroll}
					class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2 font-mono text-xs"
				>
					{#if rows.length === 0}
						<p class="py-6 text-center text-sm text-muted-foreground">로그가 없습니다.</p>
					{/if}
					{#each rows as row (row.key)}
						{#if row.log}
							{@const entry = row.log}
							<div
								class="rounded px-1 py-0.5 {entry.level === 'error'
									? 'text-destructive'
									: entry.level === 'warn'
										? 'text-amber-600 dark:text-amber-400'
										: ''}"
							>
								<div class="flex items-start gap-2">
									<span class="shrink-0 text-muted-foreground">{timeLabel(entry.at)}</span>
									<Badge variant="outline" class="shrink-0 px-1 py-0 text-[10px]">
										{kindLabels[entry.kind] ?? entry.kind}
									</Badge>
									<span class="min-w-0 break-all">{entry.message}</span>
									{#if entry.data != null}
										<button
											type="button"
											class="ml-auto shrink-0 cursor-pointer rounded bg-muted px-1.5 text-[10px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
											onclick={() => toggleData(entry.id)}
										>
											{expanded.has(entry.id) ? '데이터 ▾' : '데이터 ▸'}
										</button>
									{/if}
								</div>
								{#if entry.data != null && expanded.has(entry.id)}
									<div class="mt-0.5 ml-6 rounded bg-muted/50 p-1.5 text-foreground">
										<JsonView value={entry.data} />
									</div>
								{/if}
							</div>
						{:else if row.console}
							{@const entry = row.console}
							<div
								class="rounded px-1 py-0.5 break-all whitespace-pre-wrap {entry.kind === 'error'
									? 'text-destructive'
									: entry.kind === 'input'
										? 'font-medium text-sky-600 dark:text-sky-400'
										: 'text-muted-foreground'}"
							>
								{entry.text}
							</div>
						{/if}
					{/each}
				</div>
				{#if !stickToBottom}
					<Button
						size="sm"
						variant="secondary"
						class="absolute bottom-12 left-1/2 -translate-x-1/2 shadow"
						onclick={scrollToBottom}
					>
						<ArrowDownIcon data-icon="inline-start" />
						맨 아래로
					</Button>
				{/if}
				<form
					class="flex shrink-0 items-center gap-1.5 border-t px-2 py-1.5"
					onsubmit={submitCommand}
				>
					<ChevronRightIcon class="size-3.5 shrink-0 text-muted-foreground" />
					<input
						bind:value={commandInput}
						onkeydown={handleKeydown}
						class="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground"
						placeholder="명령 입력 — help로 목록 확인"
						autocomplete="off"
						spellcheck="false"
						aria-label="운영 명령 입력"
					/>
				</form>
			{/if}
		</div>
	{/if}
</div>
