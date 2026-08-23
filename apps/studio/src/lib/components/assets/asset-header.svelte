<script lang="ts">
	import FileArchiveIcon from '@lucide/svelte/icons/file-archive';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TagsIcon from '@lucide/svelte/icons/tags';
	import { BulkUploadKindSchema, type AssetKind, type Tag } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { ASSET_KIND_GROUPS, KIND_META } from './kinds';

	let {
		activeKind = $bindable(),
		tagId = $bindable(),
		tags,
		oncreate,
		onmanagetags,
		onbulkupload
	}: {
		activeKind: AssetKind;
		/** Empty string = no tag filter. */
		tagId: string;
		tags: Tag[];
		oncreate: () => void;
		onmanagetags: () => void;
		onbulkupload: () => void;
	} = $props();

	const selectedTag = $derived(tags.find((tag) => tag.id === tagId));
	const bulkUploadable = $derived(BulkUploadKindSchema.safeParse(activeKind).success);
</script>

<div class="flex flex-col gap-3">
	<Tabs.Root
		value={activeKind}
		onValueChange={(value) => (activeKind = value as AssetKind)}
		class="min-w-0"
	>
		<Tabs.List class="flex-wrap justify-start rounded-2xl group-data-horizontal/tabs:h-auto">
			{#each ASSET_KIND_GROUPS as group, groupIndex (group.label)}
				{#if groupIndex > 0}
					<div class="mx-1 h-4 w-px shrink-0 bg-border" role="separator"></div>
				{/if}
				{#each group.kinds as kind (kind)}
					{@const meta = KIND_META[kind]}
					<Tabs.Trigger value={kind} class="h-7 flex-none">
						<meta.icon />
						{meta.label}
					</Tabs.Trigger>
				{/each}
			{/each}
		</Tabs.List>
	</Tabs.Root>
	<div class="flex flex-wrap items-center gap-2">
		<Select.Root type="single" bind:value={tagId}>
			<Select.Trigger size="sm" class="min-w-32" aria-label="태그 필터">
				{#if selectedTag}
					<span class="size-2.5 shrink-0 rounded-full" style:background-color={selectedTag.color}
					></span>
					<span class="truncate">{selectedTag.name}</span>
				{:else}
					모든 태그
				{/if}
			</Select.Trigger>
			<Select.Content>
				<Select.Group>
					<Select.Item value="" label="모든 태그">모든 태그</Select.Item>
					{#each tags as tag (tag.id)}
						<Select.Item value={tag.id} label={tag.name}>
							<span class="size-2.5 shrink-0 rounded-full" style:background-color={tag.color}
							></span>
							{tag.name}
						</Select.Item>
					{/each}
				</Select.Group>
			</Select.Content>
		</Select.Root>
		<Button variant="outline" size="sm" onclick={onmanagetags}>
			<TagsIcon data-icon="inline-start" />
			태그 관리
		</Button>
		{#if bulkUploadable}
			<Button variant="outline" size="sm" class="ml-auto" onclick={onbulkupload}>
				<FileArchiveIcon data-icon="inline-start" />
				ZIP 업로드
			</Button>
		{/if}
		<Button size="sm" class={bulkUploadable ? '' : 'ml-auto'} onclick={oncreate}>
			<PlusIcon data-icon="inline-start" />
			새 {KIND_META[activeKind].label}
		</Button>
	</div>
</div>
