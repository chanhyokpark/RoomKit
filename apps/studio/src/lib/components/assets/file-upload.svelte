<script lang="ts">
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { uploadFile } from '$lib/api/uploads';

	let {
		themeId,
		fileKey = $bindable(),
		accept,
		id
	}: {
		themeId: string;
		fileKey: string | null;
		accept: string;
		id?: string;
	} = $props();

	let fileInput: HTMLInputElement | null = $state(null);
	let uploading = $state(false);
	let progress = $state(0);
	let errorMessage = $state<string | null>(null);

	const fileName = $derived(fileKey?.split('/').at(-1) ?? null);

	async function handleChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || uploading) return;
		uploading = true;
		progress = 0;
		errorMessage = null;
		try {
			fileKey = await uploadFile(themeId, file, (percent) => (progress = percent));
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : '업로드에 실패했습니다.';
		} finally {
			uploading = false;
		}
	}
</script>

<div class="flex flex-col gap-2">
	<input {id} type="file" {accept} class="hidden" bind:this={fileInput} onchange={handleChange} />
	{#if uploading}
		<div class="flex items-center gap-2">
			<Progress value={progress} class="flex-1" />
			<span class="w-10 text-end text-xs text-muted-foreground tabular-nums">{progress}%</span>
		</div>
	{:else if fileKey}
		<div class="flex items-center gap-2">
			<span class="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={fileName}>
				{fileName}
			</span>
			<Button type="button" variant="outline" size="sm" onclick={() => fileInput?.click()}>
				<RefreshCwIcon data-icon="inline-start" />
				교체
			</Button>
		</div>
	{:else}
		<Button type="button" variant="outline" onclick={() => fileInput?.click()}>
			<UploadIcon data-icon="inline-start" />
			파일 선택
		</Button>
	{/if}
	{#if errorMessage}
		<p class="text-xs text-destructive">{errorMessage}</p>
	{/if}
</div>
