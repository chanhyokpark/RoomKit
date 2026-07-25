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
	<Field.FieldLabel for="message-display-name">표시 이름</Field.FieldLabel>
	<Input id="message-display-name" bind:value={displayName} placeholder="비워 두면 이름을 사용" />
	<Field.FieldDescription>
		에디터의 "메시지 전송" 커맨드 선택 목록에 보여줄 이름입니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>페이로드 스키마</Field.FieldLabel>
	<Field.FieldDescription>
		여기서는 필드 구조만 정의합니다. 실제 값은 에디터에서 커맨드를 만들 때 채웁니다.
	</Field.FieldDescription>
	<FieldDefsEditor bind:fields idPrefix="message" />
</Field.Field>
