<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import type { HintStep } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Textarea } from '$lib/components/ui/textarea';
	import FileUpload from '../file-upload.svelte';
	import MediaPreview from '../media-preview.svelte';
	import JsonParamsField from './json-params-field.svelte';

	let {
		themeId,
		steps = $bindable(),
		answer = $bindable(),
		paramsText = $bindable()
	}: {
		themeId: string;
		steps: HintStep[];
		answer: HintStep | null;
		paramsText: string;
	} = $props();

	function addStep() {
		steps.push({ textHtml: '', imageKey: null });
	}

	function removeStep(index: number) {
		steps.splice(index, 1);
	}

	function moveStep(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= steps.length) return;
		[steps[index], steps[target]] = [steps[target], steps[index]];
	}
</script>

<Field.Field>
	<Field.FieldLabel>단계 (순서대로 공개)</Field.FieldLabel>
	{#each steps as step, index (index)}
		<Card.Root class="gap-3 py-3">
			<Card.Header class="px-3">
				<Card.Title class="text-xs text-muted-foreground">{index + 1}단계</Card.Title>
				<Card.Action class="flex gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={index === 0}
						onclick={() => moveStep(index, -1)}
					>
						<ChevronUpIcon />
						<span class="sr-only">위로 이동</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={index === steps.length - 1}
						onclick={() => moveStep(index, 1)}
					>
						<ChevronDownIcon />
						<span class="sr-only">아래로 이동</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={steps.length === 1}
						onclick={() => removeStep(index)}
					>
						<Trash2Icon />
						<span class="sr-only">단계 삭제</span>
					</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2 px-3">
				<Textarea bind:value={step.textHtml} rows={3} placeholder="힌트 내용 (HTML 허용)" />
				{#if step.imageKey}
					<MediaPreview fileKey={step.imageKey} media="image" />
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="self-start"
						onclick={() => (step.imageKey = null)}
					>
						<XIcon data-icon="inline-start" />
						이미지 제거
					</Button>
				{:else}
					<FileUpload {themeId} bind:fileKey={step.imageKey} accept="image/*" />
				{/if}
			</Card.Content>
		</Card.Root>
	{/each}
	<Button type="button" variant="outline" onclick={addStep}>
		<PlusIcon data-icon="inline-start" />
		단계 추가
	</Button>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>정답 (마지막 단계 이후 공개)</Field.FieldLabel>
	{#if answer}
		<Card.Root class="gap-3 py-3">
			<Card.Header class="px-3">
				<Card.Title class="text-xs text-muted-foreground">정답</Card.Title>
				<Card.Action>
					<Button type="button" variant="ghost" size="icon-sm" onclick={() => (answer = null)}>
						<Trash2Icon />
						<span class="sr-only">정답 삭제</span>
					</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2 px-3">
				<Textarea bind:value={answer.textHtml} rows={3} placeholder="정답 내용 (HTML 허용)" />
				{#if answer.imageKey}
					<MediaPreview fileKey={answer.imageKey} media="image" />
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="self-start"
						onclick={() => {
						if (answer) answer.imageKey = null;
					}}
					>
						<XIcon data-icon="inline-start" />
						이미지 제거
					</Button>
				{:else}
					<FileUpload {themeId} bind:fileKey={answer.imageKey} accept="image/*" />
				{/if}
			</Card.Content>
		</Card.Root>
	{:else}
		<p class="text-sm text-muted-foreground">
			정답을 추가하면 힌트폰에서 마지막 단계 다음에 정답을 열어 볼 수 있습니다.
		</p>
		<Button
			type="button"
			variant="outline"
			onclick={() => (answer = { textHtml: '', imageKey: null })}
		>
			<PlusIcon data-icon="inline-start" />
			정답 추가
		</Button>
	{/if}
</Field.Field>

<JsonParamsField id="hint-params" bind:paramsText />
