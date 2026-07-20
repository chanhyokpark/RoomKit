<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';

	let { url = $bindable() }: { url: string } = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="website-url">URL</Field.FieldLabel>
	<Input id="website-url" type="url" bind:value={url} placeholder="https://example.com" />
	<Field.FieldDescription>
		플레이어 iframe에서 열리는 사이트는 helper 스크립트가 삽입되어 있어야 합니다.
	</Field.FieldDescription>
</Field.Field>
