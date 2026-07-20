<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { MessageField, MessageFieldType } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';

	let {
		displayName = $bindable(),
		fields = $bindable()
	}: {
		displayName: string;
		fields: MessageField[];
	} = $props();

	const TYPE_LABELS: Record<MessageFieldType, string> = {
		string: '문자열',
		number: '숫자',
		boolean: '불리언',
		json: 'JSON'
	};

	function addField() {
		fields.push({ key: '', label: '', type: 'string', required: true });
	}

	function removeField(index: number) {
		fields.splice(index, 1);
	}

	function moveField(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= fields.length) return;
		[fields[index], fields[target]] = [fields[target], fields[index]];
	}
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
	{#each fields as field, index (index)}
		<Card.Root class="gap-3 py-3">
			<Card.Header class="px-3">
				<Card.Title class="text-xs text-muted-foreground">필드 {index + 1}</Card.Title>
				<Card.Action class="flex gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={index === 0}
						onclick={() => moveField(index, -1)}
					>
						<ChevronUpIcon />
						<span class="sr-only">위로 이동</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={index === fields.length - 1}
						onclick={() => moveField(index, 1)}
					>
						<ChevronDownIcon />
						<span class="sr-only">아래로 이동</span>
					</Button>
					<Button type="button" variant="ghost" size="icon-sm" onclick={() => removeField(index)}>
						<Trash2Icon />
						<span class="sr-only">필드 삭제</span>
					</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2 px-3">
				<div class="flex gap-2">
					<Input bind:value={field.key} placeholder="키 (예: action)" class="flex-1 font-mono" />
					<Select.Root
						type="single"
						value={field.type}
						onValueChange={(value) => (field.type = value as MessageFieldType)}
					>
						<Select.Trigger size="sm" class="w-24">{TYPE_LABELS[field.type]}</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each Object.entries(TYPE_LABELS) as [value, label] (value)}
									<Select.Item {value} {label}>{label}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>
				<Input bind:value={field.label} placeholder="라벨 (에디터 입력란 이름)" />
				<div class="flex items-center gap-2">
					<Checkbox id="message-field-required-{index}" bind:checked={field.required} />
					<Label for="message-field-required-{index}" class="text-sm font-normal">필수 값</Label>
				</div>
			</Card.Content>
		</Card.Root>
	{/each}
	<Button type="button" variant="outline" onclick={addField}>
		<PlusIcon data-icon="inline-start" />
		필드 추가
	</Button>
</Field.Field>
