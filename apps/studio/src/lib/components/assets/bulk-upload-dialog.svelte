<script lang="ts">
	import CheckIcon from '@lucide/svelte/icons/check';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import XIcon from '@lucide/svelte/icons/x';
	import type { BulkUploadKind, BulkUploadResult } from '@roomkit/shared';
	import { uploadMediaZip } from '$lib/api/uploads';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Progress } from '$lib/components/ui/progress';
	import { KIND_META } from './kinds';

	let {
		open = $bindable(),
		themeId,
		kind,
		onimported
	}: {
		open: boolean;
		themeId: string;
		kind: BulkUploadKind;
		/** Called after a successful import so the list can refresh. */
		onimported: () => void;
	} = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let progress = $state(0);
	let extracting = $state(false);
	let error = $state<string | null>(null);
	let result = $state<BulkUploadResult | null>(null);

	const kindLabel = $derived(KIND_META[kind].label);

	function reset() {
		uploading = false;
		progress = 0;
		extracting = false;
		error = null;
		result = null;
	}

	async function handleFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		reset();
		uploading = true;
		try {
			result = await uploadMediaZip(themeId, kind, file, (percent) => {
				progress = percent;
				if (percent >= 100) extracting = true;
			});
			if (result.created.length > 0) onimported();
		} catch (err) {
			error = err instanceof Error ? err.message : '업로드에 실패했습니다.';
		} finally {
			uploading = false;
			extracting = false;
			if (fileInput) fileInput.value = '';
		}
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (!value) reset();
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{kindLabel} ZIP 업로드</Dialog.Title>
			<Dialog.Description>
				{#if kind === 'dialogue'}
					ZIP 안의 음성 파일이 애셋으로 일괄 등록됩니다. <code>이름_1.mp3</code>,
					<code>이름_2.mp3</code>처럼 숫자 접미사가 붙은 파일은 같은 대사의 라인으로 묶이고, 자막은
					편집 화면에서 입력합니다.
				{:else}
					ZIP 안의 미디어 파일마다 파일명(확장자 제외)을 이름으로 하는 {kindLabel} 애셋이 생성됩니다.
				{/if}
				ZIP 내 파일명은 UTF-8이어야 합니다.
			</Dialog.Description>
		</Dialog.Header>

		<input
			bind:this={fileInput}
			type="file"
			accept=".zip,application/zip"
			class="hidden"
			onchange={handleFile}
		/>

		<div class="flex flex-col gap-3">
			<Button
				type="button"
				variant="outline"
				disabled={uploading}
				onclick={() => fileInput?.click()}
			>
				<UploadIcon data-icon="inline-start" />
				ZIP 파일 선택
			</Button>

			{#if uploading}
				<div class="flex items-center gap-2">
					<Progress value={extracting ? null : progress} class="h-2" />
					<span class="shrink-0 text-xs text-muted-foreground">
						{extracting ? '서버에서 압축 해제 중…' : `${progress}%`}
					</span>
				</div>
			{/if}

			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			{#if result}
				<div class="flex max-h-64 flex-col gap-2 overflow-y-auto rounded-md border p-3 text-sm">
					{#if result.created.length === 0 && result.skipped.length === 0}
						<p class="text-muted-foreground">ZIP에서 사용할 수 있는 파일을 찾지 못했습니다.</p>
					{/if}
					{#each result.created as item (item.assetId)}
						<div class="flex items-center gap-2">
							<CheckIcon class="size-4 shrink-0 text-green-600" />
							<span class="truncate font-medium">{item.name}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								파일 {item.files.length}개
							</span>
						</div>
					{/each}
					{#each result.skipped as item (item.file)}
						<div class="flex items-center gap-2">
							<XIcon class="size-4 shrink-0 text-muted-foreground" />
							<span class="truncate text-muted-foreground">{item.file}</span>
							<span class="shrink-0 text-xs text-muted-foreground">{item.reason}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (open = false)}>닫기</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
