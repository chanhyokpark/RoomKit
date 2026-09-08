<script lang="ts">
	import type { JsonValue, MessageField } from '@roomkit/shared';
	import FieldValuesEditor from './field-values-editor.svelte';
	import { useEditorData } from './editor-data.svelte';

	/** Sequence-editor values for a message or state asset picked by id. */
	let {
		kind = 'message',
		assetId,
		values,
		onchanged
	}: {
		kind?: 'message' | 'state';
		assetId: string | null;
		/** The command's values record — mutated in place. */
		values: Record<string, JsonValue>;
		onchanged: () => void;
	} = $props();

	const editorData = useEditorData();

	const asset = $derived(assetId === null ? undefined : editorData.byId.get(assetId));
	const fields = $derived<MessageField[]>(
		asset?.kind === 'message' || asset?.kind === 'state' ? asset.data.fields : []
	);
	/** Keys whose field was removed from the asset. */
	const staleKeys = $derived(
		asset?.kind === kind
			? Object.keys(values).filter((key) => !fields.some((field) => field.key === key))
			: []
	);
	const noun = $derived(kind === 'state' ? '상태' : '메시지');
</script>

{#if asset?.kind === kind}
	<FieldValuesEditor
		{fields}
		{values}
		{onchanged}
		{staleKeys}
		emptyText="이 {noun}에는 입력할 필드가 없습니다."
		staleText="{noun}에서 삭제된 필드입니다"
	/>
{/if}
