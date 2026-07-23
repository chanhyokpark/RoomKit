<script lang="ts">
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import { PUBLIC_API_URL } from '$env/static/public';
	import { uploadSiteZip } from '$lib/api/uploads';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Progress } from '$lib/components/ui/progress';
	import * as Tabs from '$lib/components/ui/tabs';

	let {
		themeId,
		assetId,
		mode = $bindable(),
		url = $bindable(),
		sitePrefix = $bindable()
	}: {
		themeId: string;
		/** Null while creating — the public site URL is only known after save. */
		assetId: string | null;
		mode: 'external' | 'hosted';
		url: string;
		sitePrefix: string | null;
	} = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let progress = $state(0);
	let extracting = $state(false);
	let uploadError = $state<string | null>(null);
	let lastResult = $state<{ fileCount: number; strippedRoot: string | null } | null>(null);

	const siteUrl = $derived(assetId ? `${PUBLIC_API_URL}/api/sites/${assetId}/` : null);

	async function handleFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		uploading = true;
		extracting = false;
		progress = 0;
		uploadError = null;
		try {
			const result = await uploadSiteZip(themeId, file, (percent) => {
				progress = percent;
				if (percent >= 100) extracting = true;
			});
			sitePrefix = result.sitePrefix;
			lastResult = { fileCount: result.fileCount, strippedRoot: result.strippedRoot };
		} catch (error) {
			uploadError = error instanceof Error ? error.message : '업로드에 실패했습니다.';
		} finally {
			uploading = false;
			extracting = false;
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<Field.Field>
	<Field.FieldLabel>사이트 종류</Field.FieldLabel>
	<Tabs.Root value={mode} onValueChange={(value) => (mode = value as 'external' | 'hosted')}>
		<Tabs.List class="w-full">
			<Tabs.Trigger value="external" class="flex-1">외부 URL</Tabs.Trigger>
			<Tabs.Trigger value="hosted" class="flex-1">ZIP 호스팅</Tabs.Trigger>
		</Tabs.List>
	</Tabs.Root>
</Field.Field>

{#if mode === 'external'}
	<Field.Field>
		<Field.FieldLabel for="website-url">URL</Field.FieldLabel>
		<Input id="website-url" type="url" bind:value={url} placeholder="https://example.com" />
		<Field.FieldDescription>
			플레이어 iframe에서 열리는 사이트는 helper 스크립트가 삽입되어 있어야 합니다.
		</Field.FieldDescription>
	</Field.Field>
{:else}
	<Field.Field>
		<Field.FieldLabel>사이트 ZIP</Field.FieldLabel>
		<input
			bind:this={fileInput}
			type="file"
			accept=".zip,application/zip"
			class="hidden"
			onchange={handleFile}
		/>
		<div class="flex items-center gap-2">
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={uploading}
				onclick={() => fileInput?.click()}
			>
				<UploadIcon data-icon="inline-start" />
				{sitePrefix ? 'ZIP 재업로드' : 'ZIP 업로드'}
			</Button>
			{#if sitePrefix && !uploading}
				<span class="text-xs text-muted-foreground">업로드됨</span>
			{/if}
		</div>
		{#if uploading}
			<div class="flex items-center gap-2">
				<Progress value={extracting ? null : progress} class="h-2" />
				<span class="shrink-0 text-xs text-muted-foreground">
					{extracting ? '압축 해제 중…' : `${progress}%`}
				</span>
			</div>
		{/if}
		{#if uploadError}
			<p class="text-sm text-destructive">{uploadError}</p>
		{/if}
		{#if lastResult}
			<Field.FieldDescription>
				파일 {lastResult.fileCount}개 업로드됨{lastResult.strippedRoot
					? ` (최상위 폴더 "${lastResult.strippedRoot}" 제거됨)`
					: ''}. 저장해야 적용됩니다.
			</Field.FieldDescription>
		{/if}
		<Field.FieldDescription>
			루트에 index.html이 있어야 합니다. iframe에서 열리는 사이트는 helper 스크립트가 삽입되어
			있어야 합니다.
		</Field.FieldDescription>
		{#if siteUrl && sitePrefix}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- served site URL, not app navigation -->
			<a
				href={siteUrl}
				class="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
				target="_blank"
				rel="noreferrer"
			>
				<ExternalLinkIcon class="size-3" />
				{siteUrl}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
	</Field.Field>
{/if}
