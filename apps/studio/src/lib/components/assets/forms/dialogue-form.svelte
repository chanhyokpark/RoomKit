<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { PLACEHOLDER_DURATION_DEFAULTS, type ComponentRef } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import FileUpload from '../file-upload.svelte';
	import MediaPreview from '../media-preview.svelte';
	import type { DraftDialogueLine } from '../types';
	import ComponentRefField from './component-ref-field.svelte';

	let {
		themeId,
		keepSubtitleAfterEnd = $bindable(),
		lines = $bindable(),
		subtitleComponent = $bindable()
	}: {
		themeId: string;
		keepSubtitleAfterEnd: boolean;
		lines: DraftDialogueLine[];
		subtitleComponent: ComponentRef | null;
	} = $props();

	function addLine() {
		lines.push({
			id: crypto.randomUUID(),
			fileKey: null,
			durationMs: PLACEHOLDER_DURATION_DEFAULTS.dialogueLine,
			subtitleHtml: ''
		});
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

<ComponentRefField
	{themeId}
	slotKind="subtitle"
	label="자막 컴포넌트"
	description="비워 두면 플레이어의 기본 자막 컴포넌트/CSS를 따릅니다."
	bind:value={subtitleComponent}
/>

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
				{:else}
					<div class="flex items-center gap-2">
						<Input
							type="number"
							min="1"
							step="1"
							class="w-32"
							bind:value={line.durationMs}
							aria-label="라인 {index + 1} 재생 시간 (ms)"
						/>
						<span class="text-xs text-muted-foreground">
							ms · 파일 없는 플레이스홀더 라인의 재생 시간
						</span>
					</div>
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
