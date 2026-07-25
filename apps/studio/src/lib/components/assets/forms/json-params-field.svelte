<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		id,
		paramsText = $bindable()
	}: {
		id: string;
		paramsText: string;
	} = $props();

	// Non-blocking inline hint; submit-time validation lives in asset-editor.
	const invalid = $derived.by(() => {
		if (!paramsText.trim()) return false;
		try {
			const parsed = JSON.parse(paramsText);
			return typeof parsed !== 'object' || parsed === null || Array.isArray(parsed);
		} catch {
			return true;
		}
	});
</script>

<Field.Field>
	<Field.FieldLabel for={id}>파라미터 (JSON)</Field.FieldLabel>
	<Textarea
		{id}
		class="font-mono"
		rows={4}
		bind:value={paramsText}
		placeholder={'{ "key": "value" }'}
		aria-invalid={invalid}
	/>
	<Field.FieldDescription>
		웹사이트가 이 슬롯을 직접 렌더링할 때 데이터와 함께 전달되는 자유 형식 JSON 객체입니다 (선택).
	</Field.FieldDescription>
	{#if invalid}
		<p class="text-sm text-destructive">올바른 JSON 객체가 아닙니다.</p>
	{/if}
</Field.Field>
