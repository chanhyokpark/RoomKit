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
	<Field.FieldDescription>
		에디터의 "상태 설정" 커맨드와 페이즈 등록, 운영 화면에 보여줄 이름입니다. 웹사이트는 애셋
		이름으로 상태를 구분합니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>페이로드 스키마</Field.FieldLabel>
	<Field.FieldDescription>
		여기서는 필드 구조만 정의합니다. 실제 값은 상태를 설정하는 곳(커맨드·페이즈 등록·운영 화면)에서
		채웁니다. 상태는 장치마다 하나만 활성화되며, 서버가 세션 동안 기억해 두었다가 장치가 다시
		접속하면 그대로 다시 보냅니다. 일시적인 효과에는 메시지를 사용하세요.
	</Field.FieldDescription>
	<FieldDefsEditor bind:fields idPrefix="state" />
</Field.Field>
