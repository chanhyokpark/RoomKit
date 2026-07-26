<script lang="ts">
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import CornerDownRightIcon from '@lucide/svelte/icons/corner-down-right';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { CommandType, DialogueCueEntry, SequenceEntry } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import CommandPalette from './command-palette.svelte';
	import CommandParams from './command-params.svelte';
	import { COMMAND_META, commandRefIssues, DIALOGUE_CUE_TYPES } from './commands/registry';
	import { useEditorData } from './editor-data.svelte';

	let {
		entry,
		ownEventId,
		onchanged
	}: {
		entry: Extract<SequenceEntry, { type: 'playDialogue' }>;
		ownEventId: string;
		onchanged: () => void;
	} = $props();

	const editorData = useEditorData();

	const dialogue = $derived.by(() => {
		if (entry.dialogueId === null) return null;
		const asset = editorData.byId.get(entry.dialogueId);
		return asset?.kind === 'dialogue' ? asset : null;
	});
	const lines = $derived(dialogue?.data.lines ?? []);
	/** Cues whose anchor line vanished from the asset (or became the last line). */
	const orphanCues = $derived(
		entry.lineCues.filter((cue) => {
			if (cue.sequence.length === 0) return false;
			const index = lines.findIndex((line) => line.id === cue.afterLineId);
			return index === -1 || index === lines.length - 1;
		})
	);

	let paletteOpen = $state(false);
	let paletteLineId = $state<string | null>(null);

	function stripHtml(html: string): string {
		return html.replace(/<[^>]*>/g, '');
	}

	function lineLabel(line: (typeof lines)[number], index: number): string {
		return (
			stripHtml(line.subtitleHtml) ||
			(line.fileKey === null
				? `플레이스홀더 (${line.durationMs / 1000}s)`
				: (line.fileKey.split('/').at(-1) ?? `라인 ${index + 1}`))
		);
	}

	function cueFor(lineId: string) {
		return entry.lineCues.find((cue) => cue.afterLineId === lineId);
	}

	function openPalette(lineId: string): void {
		paletteLineId = lineId;
		paletteOpen = true;
	}

	function addCommand(type: CommandType): void {
		if (paletteLineId === null) return;
		let cue = cueFor(paletteLineId);
		if (!cue) {
			cue = { afterLineId: paletteLineId, sequence: [] };
			entry.lineCues.push(cue);
		}
		// The palette is restricted to DIALOGUE_CUE_TYPES, so the created
		// command is never a (schema-forbidden) nested playDialogue.
		cue.sequence.push({
			id: crypto.randomUUID(),
			...COMMAND_META[type].create()
		} as DialogueCueEntry);
		onchanged();
	}

	function moveCommand(cue: { sequence: DialogueCueEntry[] }, index: number, delta: number): void {
		const target = index + delta;
		if (target < 0 || target >= cue.sequence.length) return;
		[cue.sequence[index], cue.sequence[target]] = [cue.sequence[target], cue.sequence[index]];
		onchanged();
	}

	function deleteCommand(
		cue: { afterLineId: string; sequence: DialogueCueEntry[] },
		index: number
	): void {
		cue.sequence.splice(index, 1);
		if (cue.sequence.length === 0) removeCue(cue.afterLineId);
		onchanged();
	}

	function removeCue(afterLineId: string): void {
		const index = entry.lineCues.findIndex((cue) => cue.afterLineId === afterLineId);
		if (index !== -1) entry.lineCues.splice(index, 1);
		onchanged();
	}
</script>

{#snippet cueCommands(cue: { afterLineId: string; sequence: DialogueCueEntry[] })}
	{#each cue.sequence as cueEntry, cueIndex (cueEntry.id)}
		{@const meta = COMMAND_META[cueEntry.type]}
		{@const issues = commandRefIssues(cueEntry, editorData.byId)}
		{@const warning = issues.dangling
			? '삭제된 애셋을 참조합니다'
			: issues.unset
				? '입력하지 않은 항목이 있습니다'
				: null}
		<div class="rounded-md border bg-background p-2">
			<div class="flex items-center gap-2">
				<meta.icon class="size-3.5 shrink-0 text-muted-foreground" />
				<span class="text-xs font-medium">{meta.label}</span>
				{#if warning}
					<span title={warning}>
						<TriangleAlertIcon class="size-3.5 text-amber-500" aria-label={warning} />
					</span>
				{/if}
				<div class="ml-auto">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon-sm">
									<EllipsisVerticalIcon />
									<span class="sr-only">커맨드 메뉴</span>
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							<DropdownMenu.Group>
								<DropdownMenu.Item
									disabled={cueIndex === 0}
									onSelect={() => moveCommand(cue, cueIndex, -1)}
								>
									<ArrowUpIcon />
									위로
								</DropdownMenu.Item>
								<DropdownMenu.Item
									disabled={cueIndex === cue.sequence.length - 1}
									onSelect={() => moveCommand(cue, cueIndex, 1)}
								>
									<ArrowDownIcon />
									아래로
								</DropdownMenu.Item>
								<DropdownMenu.Item
									variant="destructive"
									onSelect={() => deleteCommand(cue, cueIndex)}
								>
									<Trash2Icon />
									삭제
								</DropdownMenu.Item>
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</div>
			</div>
			<CommandParams entry={cueEntry} {ownEventId} {onchanged} />
		</div>
	{/each}
{/snippet}

{#if dialogue !== null}
	<div class="mt-3 w-full">
		<div class="mt-2 flex flex-col gap-1 rounded-lg border bg-muted/30 p-2">
			{#each lines as line, index (line.id)}
				{@const cue = cueFor(line.id)}
				<div class="flex min-w-0 items-center gap-2">
					<span class="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
						{index + 1}
					</span>
					<span class="truncate text-xs text-muted-foreground">{lineLabel(line, index)}</span>
				</div>
				{#if index < lines.length - 1}
					<div class="mb-1 ml-7 flex flex-col gap-1.5">
						{#if cue && cue.sequence.length > 0}
							<div class="flex items-start gap-1.5">
								<CornerDownRightIcon class="mt-2 size-3.5 shrink-0 text-muted-foreground" />
								<div class="flex min-w-0 flex-1 flex-col gap-1.5">
									{@render cueCommands(cue)}
									<Button
										variant="ghost"
										size="sm"
										class="h-6 w-fit px-2 text-xs text-muted-foreground"
										onclick={() => openPalette(line.id)}
									>
										<PlusIcon data-icon="inline-start" />
										커맨드 추가
									</Button>
								</div>
							</div>
						{:else}
							<Button
								variant="ghost"
								size="sm"
								class="h-6 w-fit border border-dashed px-2 text-xs text-muted-foreground"
								onclick={() => openPalette(line.id)}
							>
								<PlusIcon data-icon="inline-start" />
								커맨드 추가
							</Button>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
		{#each orphanCues as cue (cue.afterLineId)}
			<div class="mt-2 rounded-lg border border-amber-500/50 p-2">
				<div class="flex items-center gap-2">
					<TriangleAlertIcon class="size-3.5 shrink-0 text-amber-500" />
					<span class="text-xs text-muted-foreground">
						원래 위치한 라인이 없어져 실행되지 않는 커맨드입니다. 다른 라인 사이로 다시 추가하거나
						삭제하세요.
					</span>
					<Button
						variant="ghost"
						size="sm"
						class="ml-auto h-6 shrink-0 px-2 text-xs"
						onclick={() => removeCue(cue.afterLineId)}
					>
						모두 삭제
					</Button>
				</div>
				<div class="mt-1.5 flex flex-col gap-1.5">
					{@render cueCommands(cue)}
				</div>
			</div>
		{/each}
	</div>
{:else if entry.lineCues.some((cue) => cue.sequence.length > 0)}
	<p class="mt-2 w-full text-xs text-amber-600">
		라인 사이 커맨드가 있지만 대사가 선택되지 않아 실행되지 않습니다.
	</p>
{/if}

<CommandPalette bind:open={paletteOpen} allowedTypes={DIALOGUE_CUE_TYPES} onselect={addCommand} />
