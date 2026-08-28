<script lang="ts">
	import { onDestroy } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ListPlusIcon from '@lucide/svelte/icons/list-plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { dragHandleZone } from 'svelte-dnd-action';
	import {
		SequenceSchema,
		type CommandType,
		type SequenceEntry,
		type TriggerKind
	} from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import { Spinner } from '$lib/components/ui/spinner';
	import { updateAsset } from '$lib/api/assets';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import CommandPalette from './command-palette.svelte';
	import CommandRow from './command-row.svelte';
	import { COMMAND_META } from './commands/registry';
	import { useEditorData, type EventAsset } from './editor-data.svelte';
	import { triggerNameLabel } from '$lib/system-triggers';

	let { event, oneditmeta }: { event: EventAsset; oneditmeta: () => void } = $props();

	const editorData = useEditorData();
	const isMobile = new IsMobile();

	// The host keys this component by event id, so init-once is safe.
	// svelte-ignore state_referenced_locally
	let entries = $state<SequenceEntry[]>(
		structuredClone($state.snapshot(event.data.sequence) as SequenceEntry[])
	);
	let paletteOpen = $state(false);
	/** Null appends; a number inserts the palette selection at that index. */
	let paletteInsertIndex = $state<number | null>(null);
	let saveState = $state<'saved' | 'saving' | 'error'>('saved');

	const TRIGGER_LABELS: Record<TriggerKind, string> = {
		device: '장치 트리거',
		manual: '수동 트리거',
		system: '시스템 트리거'
	};
	const triggerSummary = $derived(
		event.data.triggerName
			? `${TRIGGER_LABELS[event.data.triggerKind]} · ${triggerNameLabel(event.data.triggerName)}`
			: TRIGGER_LABELS[event.data.triggerKind]
	);

	$effect(() => {
		// A dismissed insertion palette must not affect the next inline append.
		if (!paletteOpen) paletteInsertIndex = null;
	});

	// ── autosave ─────────────────────────────────────────────────────────────
	const DEBOUNCE_MS = 800;
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saving = false;
	let pendingAgain = false;

	function scheduleSave(immediate = false): void {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		if (immediate) void flush();
		else saveTimer = setTimeout(() => void flush(), DEBOUNCE_MS);
	}

	async function flush(): Promise<void> {
		if (saveTimer) {
			clearTimeout(saveTimer);
			saveTimer = null;
		}
		if (saving) {
			pendingAgain = true;
			return;
		}
		saving = true;
		saveState = 'saving';
		try {
			// Spread the freshest metadata from the store so a concurrent edit via
			// the metadata dialog isn't clobbered by this full-data replacement.
			const latest = editorData.events.find((candidate) => candidate.id === event.id) ?? event;
			const data = {
				...$state.snapshot(latest.data),
				sequence: SequenceSchema.parse($state.snapshot(entries))
			};
			await updateAsset(editorData.themeId, event.id, { data });
			saveState = 'saved';
			await editorData.refresh();
		} catch {
			saveState = 'error';
		} finally {
			saving = false;
			if (pendingAgain) {
				pendingAgain = false;
				void flush();
			}
		}
	}

	// Switching events destroys this component ({#key}); flush pending edits.
	onDestroy(() => {
		if (saveTimer) void flush();
	});
	beforeNavigate(() => {
		if (saveTimer) void flush();
	});

	function handleBeforeUnload(unloadEvent: BeforeUnloadEvent): void {
		if (saveTimer || saving) {
			void flush();
			unloadEvent.preventDefault();
		}
	}

	// ── stack mutations ──────────────────────────────────────────────────────
	function addCommand(type: CommandType): void {
		const entry = { id: crypto.randomUUID(), ...COMMAND_META[type].create() } as SequenceEntry;
		if (paletteInsertIndex === null) entries.push(entry);
		else entries.splice(paletteInsertIndex, 0, entry);
		paletteInsertIndex = null;
		scheduleSave(true);
	}

	function openAppendPalette(): void {
		paletteInsertIndex = null;
		paletteOpen = true;
	}

	function openInsertPalette(index: number): void {
		paletteInsertIndex = index;
		paletteOpen = true;
	}

	function duplicateEntry(index: number): void {
		const snapshot = $state.snapshot(entries[index]) as SequenceEntry;
		entries.splice(index + 1, 0, { ...snapshot, id: crypto.randomUUID() });
		scheduleSave(true);
	}

	function deleteEntry(index: number): void {
		entries.splice(index, 1);
		scheduleSave(true);
	}

	type DndEvent = CustomEvent<{ items: SequenceEntry[] }>;

	function handleDndConsider(dndEvent: DndEvent): void {
		entries = dndEvent.detail.items;
	}

	function handleDndFinalize(dndEvent: DndEvent): void {
		entries = dndEvent.detail.items;
		scheduleSave(true);
	}
</script>

<svelte:window onbeforeunload={handleBeforeUnload} />

<div class="flex min-h-0 flex-1">
	<div class="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
		<div class="flex flex-wrap items-center gap-2">
			<div class="min-w-0">
				<h2 class="truncate text-base font-semibold">{event.name}</h2>
				<p class="truncate font-mono text-xs text-muted-foreground">{triggerSummary}</p>
			</div>
			<div class="ml-auto flex items-center gap-2">
				{#if saveState === 'saving'}
					<span class="flex items-center gap-1 text-xs text-muted-foreground">
						<Spinner class="size-3" />
						저장 중
					</span>
				{:else if saveState === 'error'}
					<span class="text-xs text-destructive">저장 실패</span>
					<Button variant="outline" size="sm" onclick={() => scheduleSave(true)}>재시도</Button>
				{:else}
					<span class="flex items-center gap-1 text-xs text-muted-foreground">
						<CheckIcon class="size-3" />
						저장됨
					</span>
				{/if}
				<Button variant="outline" size="sm" onclick={oneditmeta}>
					<PencilIcon data-icon="inline-start" />
					메타데이터 수정
				</Button>
			</div>
		</div>

		{#if entries.length === 0}
			<div class="flex flex-1 items-center justify-center py-12">
				<Empty.Root>
					<Empty.Header>
						<Empty.Media variant="icon">
							<ListPlusIcon />
						</Empty.Media>
						<Empty.Title>커맨드가 없습니다</Empty.Title>
						<Empty.Description>
							{isMobile.current
								? '이벤트가 실행할 커맨드를 순서대로 쌓아 보세요.'
								: '오른쪽 팔레트에서 커맨드를 선택해 순서대로 쌓아 보세요.'}
						</Empty.Description>
					</Empty.Header>
					{#if isMobile.current}
						<Empty.Content>
							<Button onclick={openAppendPalette}>
								<PlusIcon data-icon="inline-start" />
								커맨드 추가
							</Button>
						</Empty.Content>
					{/if}
				</Empty.Root>
			</div>
		{:else}
			<div
				class="mx-auto flex w-full max-w-2xl flex-col gap-2"
				use:dragHandleZone={{
					items: entries,
					flipDurationMs: 150,
					dropTargetStyle: {}
				}}
				onconsider={handleDndConsider}
				onfinalize={handleDndFinalize}
			>
				{#each entries as entry, index (entry.id)}
					<CommandRow
						{entry}
						ownEventId={event.id}
						onchanged={() => scheduleSave()}
						oninsert={(offset) => openInsertPalette(index + offset)}
						onduplicate={() => duplicateEntry(index)}
						ondelete={() => deleteEntry(index)}
					/>
				{/each}
			</div>
			{#if isMobile.current}
				<div class="mx-auto w-full max-w-2xl">
					<Button variant="outline" class="w-full border-dashed" onclick={openAppendPalette}>
						<PlusIcon data-icon="inline-start" />
						커맨드 추가
					</Button>
				</div>
			{/if}
		{/if}
	</div>

	{#if !isMobile.current}
		<aside class="flex w-64 shrink-0 flex-col border-l">
			<div class="flex h-12 shrink-0 items-center border-b px-4">
				<h3 class="text-sm font-semibold">커맨드 팔레트</h3>
			</div>
			<CommandPalette inline onselect={addCommand} />
		</aside>
	{/if}
</div>

<CommandPalette bind:open={paletteOpen} onselect={addCommand} />
