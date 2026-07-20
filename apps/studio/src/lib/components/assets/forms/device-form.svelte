<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';

	let {
		displayName = $bindable(),
		isHintDevice = $bindable()
	}: { displayName: string; isHintDevice: boolean } = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="device-display-name">표시 이름</Field.FieldLabel>
	<Input id="device-display-name" bind:value={displayName} placeholder="비워 두면 이름을 사용" />
	<Field.FieldDescription>
		운영 화면 등에 보여줄 이름입니다. 이름은 내부 식별용으로 유지됩니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="device-hint">힌트 장치</Field.FieldLabel>
		<Field.FieldDescription>
			힌트 코드 입력 UI를 담당합니다. 힌트 전송도 이 장치로 갑니다.
		</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="device-hint" bind:checked={isHintDevice} />
</Field.Field>
