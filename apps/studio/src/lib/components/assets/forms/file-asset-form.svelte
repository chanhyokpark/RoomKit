<script lang="ts">
	import * as Field from '$lib/components/ui/field';
	import FileUpload from '../file-upload.svelte';
	import MediaPreview from '../media-preview.svelte';

	let {
		themeId,
		fileKey = $bindable(),
		accept,
		media
	}: {
		themeId: string;
		fileKey: string | null;
		accept: string;
		media: 'audio' | 'video';
	} = $props();
</script>

<Field.Field>
	<Field.FieldLabel for="asset-file">파일</Field.FieldLabel>
	<FileUpload id="asset-file" {themeId} bind:fileKey {accept} />
	{#if fileKey}
		<MediaPreview {fileKey} {media} />
	{/if}
</Field.Field>
