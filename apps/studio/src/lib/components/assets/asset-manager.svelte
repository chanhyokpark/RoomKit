<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import type { Asset, AssetKind, Tag } from '@roomkit/shared';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { deleteAsset, listAssets } from '$lib/api/assets';
	import { listTags } from '$lib/api/tags';
	import TagManagerDialog from '$lib/components/tags/tag-manager-dialog.svelte';
	import { playback } from '$lib/stores/playback.svelte';
	import AssetEditorHost from './asset-editor-host.svelte';
	import AssetGrid from './asset-grid.svelte';
	import AssetHeader from './asset-header.svelte';
	import AssetTable from './asset-table.svelte';
	import { KIND_META } from './kinds';
	import type { EditorState } from './types';

	let { themeId }: { themeId: string } = $props();

	let activeKind = $state<AssetKind>('device');
	let tagId = $state('');
	let assets = $state<Asset[]>([]);
	let tags = $state<Tag[]>([]);
	let loading = $state(true);
	let editing = $state<EditorState | null>(null);
	let deleteTarget = $state<Asset | null>(null);
	let deleting = $state(false);
	let tagManagerOpen = $state(false);

	let requestId = 0;

	$effect(() => {
		void refreshAssets(activeKind, tagId);
		// Leaving the current list view stops any preview playback.
		return () => playback.stop();
	});

	void refreshTags();

	async function refreshAssets(kind: AssetKind = activeKind, tag: string = tagId): Promise<void> {
		const rid = ++requestId;
		loading = true;
		try {
			const result = await listAssets(themeId, { kind, tagId: tag || undefined });
			if (rid === requestId) assets = result;
		} catch {
			if (rid === requestId) toast.error('애셋 목록을 불러오지 못했습니다.');
		} finally {
			if (rid === requestId) loading = false;
		}
	}

	async function refreshTags(): Promise<void> {
		try {
			tags = await listTags(themeId);
			if (tagId && !tags.some((tag) => tag.id === tagId)) tagId = '';
		} catch {
			toast.error('태그 목록을 불러오지 못했습니다.');
		}
	}

	function handleEdit(asset: Asset) {
		editing = { mode: 'edit', asset };
	}

	function handleCreate() {
		editing = { mode: 'create', kind: activeKind };
	}

	async function handleSaved() {
		editing = null;
		await refreshAssets();
	}

	async function handleDelete() {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await deleteAsset(themeId, deleteTarget.id);
			if (editing?.mode === 'edit' && editing.asset.id === deleteTarget.id) editing = null;
			toast.success('애셋을 삭제했습니다.');
			deleteTarget = null;
			await refreshAssets();
		} catch {
			toast.error('애셋 삭제에 실패했습니다.');
		} finally {
			deleting = false;
		}
	}

	async function handleTagsChanged() {
		await refreshTags();
		// Tag renames/recolors are embedded in asset payloads, so refetch those too.
		await refreshAssets();
	}
</script>

<div class="flex min-h-0 flex-1">
	<div class="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
		<AssetHeader
			bind:activeKind
			bind:tagId
			{tags}
			oncreate={handleCreate}
			onmanagetags={() => (tagManagerOpen = true)}
		/>
		{#if loading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-24 w-full" />
				<Skeleton class="h-24 w-full" />
			</div>
		{:else if assets.length === 0}
			{@const meta = KIND_META[activeKind]}
			<div class="flex flex-1 items-center justify-center">
				<Empty.Root>
					<Empty.Header>
						<Empty.Media variant="icon">
							<meta.icon />
						</Empty.Media>
						<Empty.Title>{meta.label} 애셋이 없습니다</Empty.Title>
						<Empty.Description>
							{tagId ? '선택한 태그에 해당하는 애셋이 없습니다.' : '새 애셋을 만들어 보세요.'}
						</Empty.Description>
					</Empty.Header>
					<Empty.Content>
						<Button onclick={handleCreate}>
							<PlusIcon data-icon="inline-start" />
							새 {meta.label}
						</Button>
					</Empty.Content>
				</Empty.Root>
			</div>
		{:else if KIND_META[activeKind].layout === 'grid'}
			<AssetGrid {assets} onedit={handleEdit} ondelete={(asset) => (deleteTarget = asset)} />
		{:else}
			<AssetTable {assets} onedit={handleEdit} ondelete={(asset) => (deleteTarget = asset)} />
		{/if}
	</div>
	<AssetEditorHost
		{editing}
		{themeId}
		{tags}
		onclose={() => (editing = null)}
		onsaved={handleSaved}
	/>
</div>

<TagManagerDialog bind:open={tagManagerOpen} {themeId} {tags} onchanged={handleTagsChanged} />

<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(open) => {
		if (!open) deleteTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>애셋을 삭제할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				"{deleteTarget?.name}" 애셋이 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>취소</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" disabled={deleting} onclick={handleDelete}>
				삭제
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
