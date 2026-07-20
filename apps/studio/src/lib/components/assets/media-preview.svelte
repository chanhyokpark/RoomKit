<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { getFileUrl } from '$lib/api/uploads';

	let {
		fileKey,
		media
	}: {
		fileKey: string;
		media: 'audio' | 'video' | 'image';
	} = $props();

	let url = $state<string | null>(null);
	let failed = $state(false);

	// Presigned URLs expire, so resolve a fresh one whenever the key changes.
	$effect(() => {
		const key = fileKey;
		url = null;
		failed = false;
		getFileUrl(key).then(
			(resolved) => {
				if (key === fileKey) url = resolved;
			},
			() => {
				if (key === fileKey) failed = true;
			}
		);
	});
</script>

{#if failed}
	<p class="text-xs text-destructive">미리보기를 불러오지 못했습니다.</p>
{:else if url === null}
	<Skeleton class="h-10 w-full" />
{:else if media === 'audio'}
	<audio controls src={url} class="w-full"></audio>
{:else if media === 'video'}
	<!-- svelte-ignore a11y_media_has_caption -->
	<video controls src={url} class="max-h-96 w-full rounded-md bg-black"></video>
{:else}
	<img src={url} alt="업로드한 이미지 미리보기" class="max-h-40 rounded-md object-contain" />
{/if}
