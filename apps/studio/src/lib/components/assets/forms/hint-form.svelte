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

	let {
		themeId,
		steps = $bindable()
	}: {
		themeId: string;
		steps: HintStep[];
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
