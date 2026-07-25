<script lang="ts">
	import type { ComponentSlot, MessageField } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import ComponentPreview from './component-preview.svelte';
	import FieldDefsEditor from './field-defs-editor.svelte';

	let {
		themeId,
		slot = $bindable(),
		html = $bindable(),
		interactive = $bindable(),
		params = $bindable()
	}: {
		themeId: string;
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
	const SLOT_PLACEHOLDERS: Record<ComponentSlot, string> = {
		video:
			'<div class="time">{{video.currentTime}} / {{video.duration}}</div>\n<style>.time { … }</style>',
		subtitle: '<div class="sub" data-rk-html="subtitle.html"></div>\n<style>.sub { … }</style>',
		hintCode: '<div class="code">{{hintCode.code}}</div>\n<style>.code { … }</style>'
	};
	/** Template-only starters — no JS needed for the common cases. */
	const SLOT_EXAMPLES: Record<ComponentSlot, string> = {
		subtitle: `<div class="sub" data-rk-html="subtitle.html"></div>
<style>
  .sub {
    position: absolute;
    left: 50%;
    bottom: 8%;
    transform: translateX(-50%);
    max-width: 80%;
    padding: 0.4em 1.2em;
    border-radius: 0.6em;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    font-size: 2.4vw;
    line-height: 1.5;
    text-align: center;
  }
  .sub:empty { display: none; }
</style>`,
		hintCode: `<div class="code">{{hintCode.code}}</div>
<style>
  .code {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    font-family: ui-monospace, monospace;
    font-size: 14vw;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-shadow: 0 0 0.3em rgba(255, 255, 255, 0.45);
  }
</style>`,
		video: `<div class="panel">
  <p class="title">{{props.title}}</p>
  <p class="time">{{video.currentTime}} / {{video.duration}}</p>
  <div class="bar"><div class="fill" style="width: {{video.progressPercent}}%"></div></div>
</div>
<style>
  .panel {
    position: absolute;
    right: 3%;
    bottom: 5%;
    min-width: 24%;
    padding: 1em 1.2em;
    border-radius: 0.8em;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-family: system-ui, sans-serif;
  }
  .title { margin: 0 0 0.4em; font-size: 1.4vw; font-weight: 600; }
  .time { margin: 0 0 0.6em; font-size: 1.1vw; opacity: 0.8; }
  .bar { height: 0.4em; border-radius: 0.2em; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
  .fill { height: 100%; background: #fff; }
</style>`
	};

	function fillExample(): void {
		if (html.trim() !== '' && !confirm('현재 HTML을 예시 코드로 바꿀까요?')) return;
		html = SLOT_EXAMPLES[slot];
	}
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
	<div class="flex items-center justify-between">
		<Field.FieldLabel for="component-html">HTML</Field.FieldLabel>
		<Button type="button" variant="outline" size="sm" onclick={fillExample}>예시 채우기</Button>
	</div>
	<Textarea
		id="component-html"
		bind:value={html}
		rows={16}
		class="font-mono text-xs"
		spellcheck={false}
		placeholder={SLOT_PLACEHOLDERS[slot]}
	/>
	<Field.FieldDescription>
		자바스크립트 없이 {'{{ … }}'} 템플릿으로 재생 상태·속성을 표시할 수 있습니다 — 예:
		{'{{props.키}}'}, {'{{hintCode.code}}'}, {'{{video.currentTime}}'}, 자막 HTML은
		data-rk-html="subtitle.html". 이미지 등은 {'{{media:애셋 이름}}'} 또는 RoomKit.mediaUrl('애셋 이름')로
		참조하세요. 더 세밀한 제어가 필요하면 인라인 &lt;script&gt;에서 window.RoomKit 브리지를 사용합니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>속성 (props) 정의</Field.FieldLabel>
	<Field.FieldDescription>
		애셋에 붙일 때마다 값을 바꿔 끼울 수 있는 속성입니다. 컴포넌트에서는 {'{{props.키}}'} 템플릿이나 RoomKit.props로
		읽습니다.
	</Field.FieldDescription>
	<FieldDefsEditor bind:fields={params} idPrefix="component" />
</Field.Field>

<ComponentPreview {themeId} {html} {slot} {interactive} {params} />
