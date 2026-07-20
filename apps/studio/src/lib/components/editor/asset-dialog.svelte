<script lang="ts">
	import type { Asset, Tag } from '@roomkit/shared';
	import * as Dialog from '$lib/components/ui/dialog';
	import AssetEditor from '$lib/components/assets/asset-editor.svelte';
	import { KIND_META } from '$lib/components/assets/kinds';
	import type { EditorState } from '$lib/components/assets/types';

	let {
		themeId,
		editing,
		tags,
		defaultPhaseId,
		onsaved,
		onclose
	}: {
		themeId: string;
		/** Null = closed. */
		editing: EditorState | null;
		tags: Tag[];
		defaultPhaseId?: string;
		onsaved: (asset: Asset) => void;
		onclose: () => void;
	} = $props();

	const kind = $derived(
		editing === null ? null : editing.mode === 'create' ? editing.kind : editing.asset.kind
	);
	const title = $derived(
		kind === null
			? ''
			: editing?.mode === 'create'
				? `새 ${KIND_META[kind].label}`
				: `${KIND_META[kind].label} 수정`
	);
</script>

<Dialog.Root
	open={editing !== null}
	onOpenChange={(value) => {
		if (!value) onclose();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				{editing?.mode === 'create' ? '애셋을 만들어 바로 사용합니다.' : '애셋 정보를 수정합니다.'}
			</Dialog.Description>
		</Dialog.Header>
		{#if editing}
			{#key editing}
				<div class="-mr-2 max-h-[70dvh] overflow-y-auto pr-2">
					<AssetEditor {themeId} {editing} {tags} {defaultPhaseId} {onsaved} oncancel={onclose} />
				</div>
			{/key}
		{/if}
	</Dialog.Content>
</Dialog.Root>
