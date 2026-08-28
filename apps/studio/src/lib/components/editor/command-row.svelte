<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import GripVerticalIcon from '@lucide/svelte/icons/grip-vertical';
	import ListPlusIcon from '@lucide/svelte/icons/list-plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { dragHandle } from 'svelte-dnd-action';
	import type { SequenceEntry } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import CommandParams from './command-params.svelte';
	import DialogueCueEditor from './dialogue-cue-editor.svelte';
	import { COMMAND_META, commandRefIssues } from './commands/registry';
	import { useEditorData } from './editor-data.svelte';

	let {
		entry,
		ownEventId,
		onchanged,
		oninsert,
		onduplicate,
		ondelete
	}: {
		entry: SequenceEntry;
		ownEventId: string;
		onchanged: () => void;
		oninsert: (offset: 0 | 1) => void;
		onduplicate: () => void;
		ondelete: () => void;
	} = $props();

	const editorData = useEditorData();

	const meta = $derived(COMMAND_META[entry.type]);
	const issues = $derived(commandRefIssues(entry, editorData.byId));
	const warning = $derived(
		issues.dangling
			? '삭제된 애셋을 참조합니다'
			: issues.unset
				? '입력하지 않은 항목이 있습니다'
				: null
	);
</script>

<div class="flex items-start gap-2 rounded-lg border bg-card p-3">
	<!-- Not a <button>: svelte-dnd-action refuses to start drags from elements
		     with a .value property (its nested-input check). -->
	<div
		use:dragHandle
		data-drag-handle
		class="mt-1.5 shrink-0 touch-none text-muted-foreground"
		aria-label="드래그하여 순서 변경"
		title="드래그하여 순서 변경"
	>
		<GripVerticalIcon class="size-4" />
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-2">
			<meta.icon class="size-4 shrink-0 text-muted-foreground" />
			<span class="text-sm font-medium">{meta.label}</span>
			{#if warning}
				<span title={warning}>
					<TriangleAlertIcon class="size-4 text-amber-500" aria-label={warning} />
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
							<DropdownMenu.Item onSelect={() => oninsert(0)}>
								<ListPlusIcon />
								위에 커맨드 추가
							</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => oninsert(1)}>
								<ListPlusIcon />
								아래에 커맨드 추가
							</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={onduplicate}>
								<CopyIcon />
								복제
							</DropdownMenu.Item>
							<DropdownMenu.Item variant="destructive" onSelect={ondelete}>
								<Trash2Icon />
								삭제
							</DropdownMenu.Item>
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
		<CommandParams {entry} {ownEventId} {onchanged} />
		{#if entry.type === 'playDialogue'}
			<DialogueCueEditor {entry} {ownEventId} {onchanged} />
		{/if}
	</div>
</div>
