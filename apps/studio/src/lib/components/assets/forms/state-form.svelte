<script lang="ts">
	import type { MessageField } from '@roomkit/shared';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import FieldDefsEditor from './field-defs-editor.svelte';

	let {
		displayName = $bindable(),
		fields = $bindable()
	}: {
		displayName: string;
		fields: MessageField[];
	} = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="state-display-name">표시 이름</Field.FieldLabel>
	<Input id="state-display-name" bind:value={displayName} placeholder="비워 두면 이름을 사용" />
	<Field.FieldDescription>에디터와 운영 화면에 보여줄 이름입니다.</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>페이로드 스키마</Field.FieldLabel>
	<Field.FieldDescription>
		값은 상태를 설정하는 곳에서 채웁니다. 장치마다 하나만 활성화되며 재접속 시 다시 전달됩니다.
	</Field.FieldDescription>
	<FieldDefsEditor bind:fields idPrefix="state" />
</Field.Field>
