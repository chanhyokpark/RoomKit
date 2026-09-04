<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';

	let { orderText = $bindable() }: { orderText: string | number | null } = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="phase-order">순서</Field.FieldLabel>
	<Input id="phase-order" type="number" step="1" bind:value={orderText} placeholder="예: 1" />
	<Field.FieldDescription>게임 진행 순서입니다. 낮을수록 먼저 옵니다.</Field.FieldDescription>
</Field.Field>
