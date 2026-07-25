<script lang="ts">
	import { resolve } from '$app/paths';
	import { SystemTriggerSchema, type Asset, type TriggerKind } from '@roomkit/shared';
	import { SYSTEM_TRIGGER_LABELS, triggerNameLabel } from '$lib/system-triggers';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { listAssets } from '$lib/api/assets';

	let {
		themeId,
		phaseId = $bindable(),
		triggerKind = $bindable(),
		triggerName = $bindable(),
		manualTriggerable = $bindable(),
		allowReentry = $bindable(),
		once = $bindable(),
		sequenceLength
	}: {
		themeId: string;
		/** Empty string = common event. */
		phaseId: string;
		triggerKind: TriggerKind;
		triggerName: string;
		manualTriggerable: boolean;
		allowReentry: boolean;
		once: boolean;
		sequenceLength: number;
	} = $props();

	const TRIGGER_LABELS: Record<TriggerKind, string> = {
		device: '장치 트리거',
		manual: '수동 트리거',
		system: '시스템 트리거'
	};

	let phases = $state<Asset[]>([]);

	$effect(() => {
		listAssets(themeId, { kind: 'phase' }).then((result) => {
			phases = result;
		});
	});

	const phaseName = $derived(phases.find((phase) => phase.id === phaseId)?.name);
</script>

<Field.Field>
	<Field.FieldLabel for="event-phase">페이즈</Field.FieldLabel>
	<Select.Root type="single" bind:value={phaseId}>
		<Select.Trigger id="event-phase" class="w-full">
			{phaseId ? (phaseName ?? '페이즈 선택') : '공통 (모든 페이즈)'}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				<Select.Item value="" label="공통 (모든 페이즈)">공통 (모든 페이즈)</Select.Item>
				{#each phases as phase (phase.id)}
					<Select.Item value={phase.id} label={phase.name}>{phase.name}</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
	<Field.FieldDescription>공통 이벤트는 모든 페이즈에서 실행될 수 있습니다.</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel for="event-trigger-kind">트리거 종류</Field.FieldLabel>
	<Select.Root
		type="single"
		value={triggerKind}
		onValueChange={(value) => {
			triggerKind = value as TriggerKind;
			triggerName = '';
		}}
	>
		<Select.Trigger id="event-trigger-kind" class="w-full">
			{TRIGGER_LABELS[triggerKind]}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				{#each Object.entries(TRIGGER_LABELS) as [value, label] (value)}
					<Select.Item {value} {label}>{label}</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
</Field.Field>

{#if triggerKind === 'device'}
	<Field.Field>
		<Field.FieldLabel for="event-trigger-name">트리거 이름</Field.FieldLabel>
		<Input
			id="event-trigger-name"
			bind:value={triggerName}
			class="font-mono"
			placeholder="장치가 보고하는 이벤트 이름 (예: door-open)"
		/>
	</Field.Field>
{:else if triggerKind === 'system'}
	<Field.Field>
		<Field.FieldLabel for="event-system-trigger">시스템 훅</Field.FieldLabel>
		<Select.Root type="single" bind:value={triggerName}>
			<Select.Trigger id="event-system-trigger" class="w-full">
				{triggerName ? triggerNameLabel(triggerName) : '훅 선택'}
			</Select.Trigger>
			<Select.Content>
				<Select.Group>
					{#each SystemTriggerSchema.options as hook (hook)}
						<Select.Item value={hook} label={SYSTEM_TRIGGER_LABELS[hook]}>
							{SYSTEM_TRIGGER_LABELS[hook]}
						</Select.Item>
					{/each}
				</Select.Group>
			</Select.Content>
		</Select.Root>
	</Field.Field>
{/if}

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="event-manual">수동 실행 허용</Field.FieldLabel>
		<Field.FieldDescription>운영 화면에서 버튼으로 실행할 수 있습니다.</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="event-manual" bind:checked={manualTriggerable} />
</Field.Field>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="event-reentry">재진입 허용</Field.FieldLabel>
		<Field.FieldDescription>실행 중인 이벤트를 다시 트리거할 수 있습니다.</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="event-reentry" bind:checked={allowReentry} />
</Field.Field>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="event-once">1회만 실행</Field.FieldLabel>
		<Field.FieldDescription>
			세션에서 한 번 실행되면 다시 실행되지 않습니다. 페이즈를 다시 시작하면 해당 페이즈 이벤트의
			실행 기록이 초기화됩니다.
		</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="event-once" bind:checked={once} />
</Field.Field>

<p class="text-xs text-muted-foreground">
	시퀀스({sequenceLength}개 커맨드)는
	<a class="underline" href={resolve('/(app)/themes/[themeId]/editor', { themeId })}>에디터</a>에서
	편집합니다.
</p>
