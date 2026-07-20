<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import type { Tag } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { ApiError } from '$lib/api/client';
	import { createTag, deleteTag, updateTag } from '$lib/api/tags';

	let {
		open = $bindable(false),
		themeId,
		tags,
		onchanged
	}: {
		open?: boolean;
		themeId: string;
		tags: Tag[];
		onchanged: () => void;
	} = $props();

	let newName = $state('');
	let newColor = $state('#e11d48');
	let busy = $state(false);

	async function run(action: () => Promise<unknown>, failMessage: string) {
		if (busy) return;
		busy = true;
		try {
			await action();
			onchanged();
		} catch (error) {
			toast.error(error instanceof ApiError ? error.message : failMessage);
		} finally {
			busy = false;
		}
	}

	async function handleCreate(event: SubmitEvent) {
		event.preventDefault();
		const name = newName.trim();
		if (!name) return;
		await run(async () => {
			await createTag(themeId, { name, color: newColor });
			newName = '';
		}, '태그 생성에 실패했습니다.');
	}

	function handleRename(tag: Tag, name: string) {
		const trimmed = name.trim();
		if (!trimmed || trimmed === tag.name) return;
		void run(() => updateTag(themeId, tag.id, { name: trimmed }), '태그 수정에 실패했습니다.');
	}

	function handleRecolor(tag: Tag, color: string) {
		if (color === tag.color) return;
		void run(() => updateTag(themeId, tag.id, { color }), '태그 수정에 실패했습니다.');
	}

	function handleDelete(tag: Tag) {
		void run(() => deleteTag(themeId, tag.id), '태그 삭제에 실패했습니다.');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>태그 관리</Dialog.Title>
			<Dialog.Description>애셋 분류에 사용할 태그를 관리합니다.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-4">
			<form class="flex items-center gap-2" onsubmit={handleCreate}>
				<input
					type="color"
					bind:value={newColor}
					class="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
					aria-label="새 태그 색상"
				/>
				<Input bind:value={newName} placeholder="새 태그 이름" class="flex-1" />
				<Button type="submit" size="sm" disabled={busy || newName.trim() === ''}>
					<PlusIcon data-icon="inline-start" />
					추가
				</Button>
			</form>
			{#if tags.length === 0}
				<p class="text-sm text-muted-foreground">아직 태그가 없습니다.</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each tags as tag (tag.id)}
						<li class="flex items-center gap-2">
							<input
								type="color"
								value={tag.color}
								onchange={(event) => handleRecolor(tag, event.currentTarget.value)}
								class="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
								aria-label="{tag.name} 색상"
							/>
							<Input
								value={tag.name}
								onchange={(event) => handleRename(tag, event.currentTarget.value)}
								class="flex-1"
								aria-label="{tag.name} 이름"
							/>
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={busy}
								onclick={() => handleDelete(tag)}
							>
								<Trash2Icon />
								<span class="sr-only">{tag.name} 삭제</span>
							</Button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
