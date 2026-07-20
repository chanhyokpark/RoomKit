<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import FileUpload from '../file-upload.svelte';
	import MediaPreview from '../media-preview.svelte';
	import type { DraftDialogueLine } from '../types';

	let {
		themeId,
		keepSubtitleAfterEnd = $bindable(),
		lines = $bindable()
	}: {
		themeId: string;
		keepSubtitleAfterEnd: boolean;
		lines: DraftDialogueLine[];
	} = $props();

	function addLine() {
		lines.push({ id: crypto.randomUUID(), fileKey: null, subtitleHtml: '' });
	}

	function removeLine(index: number) {
		lines.splice(index, 1);
	}

	function moveLine(index: number, delta: -1 | 1) {
		const target = index + delta;
		if (target < 0 || target >= lines.length) return;
		[lines[index], lines[target]] = [lines[target], lines[index]];
	}
</script>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="dialogue-keep-subtitle">재생 후 자막 유지</Field.FieldLabel>
		<Field.FieldDescription>재생이 끝나도 마지막 자막을 화면에 남겨 둡니다.</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="dialogue-keep-subtitle" bind:checked={keepSubtitleAfterEnd} />
</Field.Field>

<Field.Field>
	<Field.FieldLabel>라인 (재생 순서)</Field.FieldLabel>
	{#each lines as line, index (line.id)}
		<Card.Root class="gap-3 py-3">
			<Card.Header class="px-3">
				<Card.Title class="text-xs text-muted-foreground">라인 {index + 1}</Card.Title>
				<Card.Action class="flex gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={index === 0}
						onclick={() => moveLine(index, -1)}
					>
						<ChevronUpIcon />
						<span class="sr-only">위로 이동</span>
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={index === lines.length - 1}
						onclick={() => moveLine(index, 1)}
					>
						<ChevronDownIcon />
						<span class="sr-only">아래로 이동</span>
					</Button>
					<Button type="button" variant="ghost" size="icon-sm" onclick={() => removeLine(index)}>
						<Trash2Icon />
						<span class="sr-only">라인 삭제</span>
					</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content class="flex flex-col gap-2 px-3">
				<FileUpload {themeId} bind:fileKey={line.fileKey} accept="audio/*" />
				{#if line.fileKey}
					<MediaPreview fileKey={line.fileKey} media="audio" />
				{/if}
				<Textarea bind:value={line.subtitleHtml} rows={2} placeholder="자막 (HTML 허용)" />
			</Card.Content>
		</Card.Root>
	{/each}
	<Button type="button" variant="outline" onclick={addLine}>
		<PlusIcon data-icon="inline-start" />
		라인 추가
	</Button>
</Field.Field>
