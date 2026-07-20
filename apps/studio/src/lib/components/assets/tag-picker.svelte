<script lang="ts">
	import TagIcon from '@lucide/svelte/icons/tag';
	import type { Tag } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	let {
		tags,
		tagIds = $bindable()
	}: {
		tags: Tag[];
		tagIds: string[];
	} = $props();

	const selectedTags = $derived(tags.filter((tag) => tagIds.includes(tag.id)));

	function toggle(tagId: string, checked: boolean) {
		tagIds = checked ? [...tagIds, tagId] : tagIds.filter((id) => id !== tagId);
	}
</script>

<div class="flex flex-col gap-2">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button {...props} type="button" variant="outline" size="sm" class="self-start">
					<TagIcon data-icon="inline-start" />
					태그 선택
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="start">
			<DropdownMenu.Group>
				{#if tags.length === 0}
					<DropdownMenu.Item disabled>태그가 없습니다</DropdownMenu.Item>
				{/if}
				{#each tags as tag (tag.id)}
					<DropdownMenu.CheckboxItem
						closeOnSelect={false}
						checked={tagIds.includes(tag.id)}
						onCheckedChange={(checked) => toggle(tag.id, checked)}
					>
						<span class="size-2.5 rounded-full" style:background-color={tag.color}></span>
						{tag.name}
					</DropdownMenu.CheckboxItem>
				{/each}
			</DropdownMenu.Group>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
	{#if selectedTags.length > 0}
		<div class="flex flex-wrap gap-1">
			{#each selectedTags as tag (tag.id)}
				<Badge variant="outline">
					<span class="size-2 rounded-full" style:background-color={tag.color}></span>
					{tag.name}
				</Badge>
			{/each}
		</div>
	{/if}
</div>
