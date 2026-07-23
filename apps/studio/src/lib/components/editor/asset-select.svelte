<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import type { AssetKind } from '@roomkit/shared';
	import * as Select from '$lib/components/ui/select';
	import { assetDisplayName } from '$lib/components/assets/asset-summary';
	import { KIND_META } from '$lib/components/assets/kinds';
	import type { EditorState } from '$lib/components/assets/types';
	import AssetDialog from './asset-dialog.svelte';
	import { useEditorData } from './editor-data.svelte';

	let {
		kind,
		id = $bindable(),
		label,
		excludeId,
		disabled = false,
		onchanged
	}: {
		kind: AssetKind;
		/** Null = not selected yet. */
		id: string | null;
		label: string;
		/** Hidden from the options (e.g. the event being edited, for callEvent). */
		excludeId?: string;
		/** E.g. the target select while an "all" toggle overrides it. */
		disabled?: boolean;
		onchanged: () => void;
	} = $props();

	const editorData = useEditorData();

	let creating = $state<EditorState | null>(null);

	const meta = $derived(KIND_META[kind]);
	const options = $derived(editorData.byKind(kind).filter((asset) => asset.id !== excludeId));
	const selected = $derived(id === null ? undefined : editorData.byId.get(id));
	const dangling = $derived(id !== null && (!selected || selected.kind !== kind));

	function handleChange(value: string): void {
		if (value === '__create__') {
			creating = { mode: 'create', kind };
			return;
		}
		id = value === '' ? null : value;
		onchanged();
	}
</script>

<div class="flex min-w-36 flex-1 flex-col gap-1">
	<span class="flex items-center gap-1 text-xs text-muted-foreground">
		<meta.icon class="size-3" />
		{label}
	</span>
	<Select.Root type="single" value={id ?? ''} onValueChange={handleChange} {disabled}>
		<Select.Trigger size="sm" class="w-full" aria-label={label}>
			{#if dangling}
				<span class="text-destructive">삭제된 애셋</span>
			{:else if selected}
				<span class="truncate">{assetDisplayName(selected)}</span>
			{:else}
				<span class="text-muted-foreground">선택</span>
			{/if}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				{#each options as asset (asset.id)}
					<Select.Item value={asset.id} label={assetDisplayName(asset)}>
						<div class="flex min-w-0 flex-col">
							<span class="truncate">{assetDisplayName(asset)}</span>
							{#if asset.description}
								<span class="truncate text-xs text-muted-foreground">{asset.description}</span>
							{/if}
						</div>
					</Select.Item>
				{/each}
				<Select.Item value="__create__" label="새로 만들기">
					<PlusIcon class="size-4" />
					새 {KIND_META[kind].label} 만들기
				</Select.Item>
			</Select.Group>
		</Select.Content>
	</Select.Root>
</div>

<AssetDialog
	themeId={editorData.themeId}
	editing={creating}
	tags={editorData.tags}
	onsaved={(asset) => {
		creating = null;
		id = asset.id;
		onchanged();
		void editorData.refresh();
	}}
	onclose={() => (creating = null)}
/>
