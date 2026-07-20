<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TagsIcon from '@lucide/svelte/icons/tags';
	import type { AssetKind, Tag } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { ASSET_KINDS, KIND_META } from './kinds';

	let {
		activeKind = $bindable(),
		tagId = $bindable(),
		tags,
		oncreate,
		onmanagetags
	}: {
		activeKind: AssetKind;
		/** Empty string = no tag filter. */
		tagId: string;
		tags: Tag[];
		oncreate: () => void;
		onmanagetags: () => void;
	} = $props();

	const selectedTag = $derived(tags.find((tag) => tag.id === tagId));
</script>

<div class="flex flex-col gap-3">
	<Tabs.Root
		value={activeKind}
		onValueChange={(value) => (activeKind = value as AssetKind)}
		class="min-w-0"
	>
		<div class="overflow-x-auto">
			<Tabs.List>
				{#each ASSET_KINDS as kind (kind)}
					{@const meta = KIND_META[kind]}
					<Tabs.Trigger value={kind}>
						<meta.icon />
						{meta.label}
					</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</div>
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
		<Button size="sm" class="ml-auto" onclick={oncreate}>
			<PlusIcon data-icon="inline-start" />
			새 {KIND_META[activeKind].label}
		</Button>
	</div>
</div>
