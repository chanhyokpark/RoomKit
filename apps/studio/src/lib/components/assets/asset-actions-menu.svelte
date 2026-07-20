<script lang="ts">
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';

	let { onedit, ondelete }: { onedit: () => void; ondelete: () => void } = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon-sm" onclick={(e) => e.stopPropagation()}>
				<EllipsisVerticalIcon />
				<span class="sr-only">애셋 메뉴</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end">
		<DropdownMenu.Group>
			<DropdownMenu.Item onSelect={onedit}>
				<PencilIcon />
				수정
			</DropdownMenu.Item>
			<DropdownMenu.Item variant="destructive" onSelect={ondelete}>
				<Trash2Icon />
				삭제
			</DropdownMenu.Item>
		</DropdownMenu.Group>
	</DropdownMenu.Content>
</DropdownMenu.Root>
