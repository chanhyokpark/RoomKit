<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import FileUpload from '../file-upload.svelte';
	import MediaPreview from '../media-preview.svelte';
	import PublicMediaLink from '../public-media-link.svelte';

	let {
		themeId,
		fileKey = $bindable(),
		durationMs = $bindable(),
		fadeInMs = $bindable(undefined),
		fadeOutMs = $bindable(undefined),
		accept,
		media,
		publicUrl = null
	}: {
		themeId: string;
		fileKey: string | null;
		durationMs: number;
		/** BGM only — fade fields are hidden when not passed. */
		fadeInMs?: number;
		fadeOutMs?: number;
		accept: string;
		media: 'audio' | 'video';
		/** Stable public URL shown when set (video); null while creating. */
		publicUrl?: string | null;
	} = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="asset-file">파일</Field.FieldLabel>
	<FileUpload id="asset-file" {themeId} bind:fileKey {accept} />
	{#if fileKey}
		<MediaPreview {fileKey} {media} />
		{#if publicUrl}
			<PublicMediaLink url={publicUrl} />
		{/if}
	{:else}
		<Field.FieldDescription>
			파일 없이 저장하면 테스트용 플레이스홀더 애셋이 됩니다.
		</Field.FieldDescription>
	{/if}
</Field.Field>

{#if !fileKey}
	<Field.Field>
		<Field.FieldLabel for="asset-duration">재생 시간 (ms)</Field.FieldLabel>
		<Input id="asset-duration" type="number" min="1" step="1" bind:value={durationMs} />
		<Field.FieldDescription>플레이스홀더 재생을 시뮬레이션할 시간입니다.</Field.FieldDescription>
	</Field.Field>
{/if}

{#if fadeInMs !== undefined && fadeOutMs !== undefined}
	<div class="grid grid-cols-2 gap-4">
		<Field.Field>
			<Field.FieldLabel for="asset-fade-in">페이드 인 (ms)</Field.FieldLabel>
			<Input id="asset-fade-in" type="number" min="0" step="500" bind:value={fadeInMs} />
		</Field.Field>
		<Field.Field>
			<Field.FieldLabel for="asset-fade-out">페이드 아웃 (ms)</Field.FieldLabel>
			<Input id="asset-fade-out" type="number" min="0" step="500" bind:value={fadeOutMs} />
		</Field.Field>
	</div>
	<Field.FieldDescription>
		재생 시작 시 페이드 인, 정지·교체 시 페이드 아웃으로 적용됩니다. 0 = 페이드 없음.
	</Field.FieldDescription>
{/if}
