<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import FileUpload from '../file-upload.svelte';
	import MediaPreview from '../media-preview.svelte';
	import PublicMediaLink from '../public-media-link.svelte';

	let {
		themeId,
		kind,
		fileKey = $bindable(),
		placeholderRatio = $bindable(''),
		publicUrl
	}: {
		themeId: string;
		kind: 'image' | 'file';
		fileKey: string | null;
		/** Image only — "W:H" ratio of the placeholder served while there is no file. */
		placeholderRatio?: string;
		/** Null while creating — the public media URL is only known after save. */
		publicUrl: string | null;
	} = $props();

	// Fileless images still serve (a placeholder), so their URL is always live.
	const linkActive = $derived(kind === 'image' || fileKey !== null);
	const ratioParts = $derived(/^([1-9]\d*):([1-9]\d*)$/.exec(placeholderRatio));
</script>

<Field.Field>
	<Field.FieldLabel for="asset-file">파일</Field.FieldLabel>
	<FileUpload
		id="asset-file"
		{themeId}
		bind:fileKey
		accept={kind === 'image' ? 'image/*' : '*/*'}
	/>
	{#if fileKey && kind === 'image'}
		<MediaPreview {fileKey} media="image" />
	{/if}
	{#if publicUrl && linkActive}
		<PublicMediaLink url={publicUrl} />
		<Field.FieldDescription>웹사이트에서 위 URL로 참조합니다.</Field.FieldDescription>
	{:else}
		<Field.FieldDescription>저장하면 웹사이트용 공개 URL이 생성됩니다.</Field.FieldDescription>
	{/if}
</Field.Field>

{#if kind === 'image' && !fileKey}
	<Field.Field>
		<Field.FieldLabel for="asset-placeholder-ratio">플레이스홀더 비율</Field.FieldLabel>
		<Input
			id="asset-placeholder-ratio"
			bind:value={placeholderRatio}
			placeholder="16:9"
			class="w-32 font-mono"
		/>
		<Field.FieldDescription>파일이 없을 때 제공되는 플레이스홀더 비율입니다.</Field.FieldDescription
		>
		{#if ratioParts}
			<div
				class="flex w-full max-w-xs items-center justify-center rounded-md bg-muted text-sm text-muted-foreground"
				style:aspect-ratio="{ratioParts[1]} / {ratioParts[2]}"
			>
				{ratioParts[1]}:{ratioParts[2]}
			</div>
		{/if}
	</Field.Field>
{/if}
