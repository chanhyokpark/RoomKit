<script lang="ts">
	import type { ComponentSlot, MessageField } from '@roomkit/shared';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import ComponentPreview from './component-preview.svelte';
	import FieldDefsEditor from './field-defs-editor.svelte';

	let {
		slot = $bindable(),
		html = $bindable(),
		interactive = $bindable(),
		params = $bindable()
	}: {
		slot: ComponentSlot;
		html: string;
		interactive: boolean;
		params: MessageField[];
	} = $props();

	const SLOT_LABELS: Record<ComponentSlot, string> = {
		video: '비디오',
		subtitle: '자막',
		hintCode: '힌트 코드'
	};
	const SLOT_EVENTS: Record<ComponentSlot, string> = {
		video: "RoomKit.on('video', ({currentTimeMs, durationMs}) => …)",
		subtitle: "RoomKit.on('subtitle', ({html, lineIndex, lineCount}) => …)",
		hintCode: "RoomKit.on('hintCode', ({code}) => …)"
	};
</script>

<Field.Field>
	<Field.FieldLabel for="component-slot">슬롯</Field.FieldLabel>
	<Select.Root type="single" bind:value={slot}>
		<Select.Trigger id="component-slot" class="w-full">{SLOT_LABELS[slot]}</Select.Trigger>
		<Select.Content>
			<Select.Group>
				{#each Object.entries(SLOT_LABELS) as [value, label] (value)}
					<Select.Item {value} {label}>{label}</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
	<Field.FieldDescription>
		이 컴포넌트를 붙일 수 있는 위치입니다. 슬롯을 바꾸면 다른 슬롯에 붙여 둔 곳에서는 기본 스타일로
		되돌아갑니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="component-interactive">터치/클릭 받기</Field.FieldLabel>
		<Field.FieldDescription>
			켜면 컴포넌트가 화면 전체의 터치를 가로챕니다. 아래 웹사이트를 조작해야 하면 꺼 두세요.
		</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="component-interactive" bind:checked={interactive} />
</Field.Field>

<Field.Field>
	<Field.FieldLabel for="component-html">HTML</Field.FieldLabel>
	<Textarea
		id="component-html"
		bind:value={html}
		rows={16}
		class="font-mono text-xs"
		spellcheck={false}
		placeholder={'<div id="chat"></div>\n<style>#chat { … }</style>\n<script>\n  ' +
			SLOT_EVENTS[slot] +
			'\n<' +
			'/script>'}
	/>
	<Field.FieldDescription>
		인라인 &lt;style&gt;/&lt;script&gt;를 포함한 마크업입니다. window.RoomKit으로 재생
		상태·속성(props)·메시지를 받습니다. 이미지 등은 RoomKit.mediaUrl(애셋 ID)로 참조하세요.
	</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>속성 (props) 정의</Field.FieldLabel>
	<Field.FieldDescription>
		애셋에 붙일 때마다 값을 바꿔 끼울 수 있는 속성입니다. 컴포넌트에서는 RoomKit.props로 읽습니다.
	</Field.FieldDescription>
	<FieldDefsEditor bind:fields={params} idPrefix="component" />
</Field.Field>

<ComponentPreview {html} {slot} {interactive} {params} />
