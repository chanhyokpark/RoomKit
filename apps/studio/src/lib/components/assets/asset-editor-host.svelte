<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import type { Asset, Tag } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Sheet from '$lib/components/ui/sheet';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import AssetEditor from './asset-editor.svelte';
	import { KIND_META } from './kinds';
	import type { EditorState } from './types';

	let {
		editing,
		themeId,
		tags,
		onclose,
		onsaved
	}: {
		editing: EditorState | null;
		themeId: string;
		tags: Tag[];
		onclose: () => void;
		onsaved: (asset: Asset) => void;
	} = $props();

	const isMobile = new IsMobile();

	const title = $derived.by(() => {
		if (!editing) return '';
		const label = KIND_META[editing.mode === 'create' ? editing.kind : editing.asset.kind].label;
		return editing.mode === 'create' ? `새 ${label}` : `${label} 수정`;
	});
	// Re-key the editor per target so form state resets when switching assets.
	const editorKey = $derived(
		editing === null ? '' : editing.mode === 'edit' ? editing.asset.id : `create:${editing.kind}`
	);
</script>

{#if editing}
	{#if isMobile.current}
		<Sheet.Root
			open
			onOpenChange={(open) => {
				if (!open) onclose();
			}}
		>
			<Sheet.Content side="bottom" class="max-h-[90dvh]">
				<Sheet.Header>
					<Sheet.Title>{title}</Sheet.Title>
				</Sheet.Header>
				<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
					{#key editorKey}
						<AssetEditor {themeId} {editing} {tags} {onsaved} oncancel={onclose} />
					{/key}
				</div>
			</Sheet.Content>
		</Sheet.Root>
	{:else}
		<aside class="flex w-96 shrink-0 flex-col border-l">
			<div class="flex h-12 shrink-0 items-center justify-between border-b px-4">
				<h2 class="text-sm font-semibold">{title}</h2>
				<Button variant="ghost" size="icon-sm" onclick={onclose}>
					<XIcon />
					<span class="sr-only">닫기</span>
				</Button>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto p-4">
				{#key editorKey}
					<AssetEditor {themeId} {editing} {tags} {onsaved} oncancel={onclose} />
				{/key}
			</div>
		</aside>
	{/if}
{/if}
