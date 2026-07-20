<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';

	let { displayName = $bindable() }: { displayName: string } = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="device-display-name">표시 이름</Field.FieldLabel>
	<Input id="device-display-name" bind:value={displayName} placeholder="비워 두면 이름을 사용" />
	<Field.FieldDescription>
		운영 화면 등에 보여줄 이름입니다. 이름은 내부 식별용으로 유지됩니다.
	</Field.FieldDescription>
</Field.Field>
