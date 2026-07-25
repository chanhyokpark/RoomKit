<script lang="ts">
	import type { CommandType } from '@roomkit/shared';
	import * as Command from '$lib/components/ui/command';
	import { COMMAND_GROUPS, COMMAND_META } from './commands/registry';

	let {
		open = $bindable(false),
		inline = false,
		allowedTypes,
		onselect
	}: {
		open?: boolean;
		/** Render as an always-visible pane instead of a dialog. */
		inline?: boolean;
		/** Restrict the palette to these types (e.g. the website-test console). */
		allowedTypes?: CommandType[];
		onselect: (type: CommandType) => void;
	} = $props();

	const groups = $derived(
		allowedTypes === undefined
			? COMMAND_GROUPS
			: COMMAND_GROUPS.map((group) => ({
					...group,
					types: group.types.filter((type) => allowedTypes.includes(type))
				})).filter((group) => group.types.length > 0)
	);
</script>

{#snippet palette()}
	<Command.Input placeholder="커맨드 검색..." />
	<Command.List class={inline ? 'max-h-none flex-1' : undefined}>
		<Command.Empty>커맨드를 찾을 수 없습니다.</Command.Empty>
		{#each groups as group (group.label)}
			<Command.Group heading={group.label}>
				{#each group.types as type (type)}
					{@const meta = COMMAND_META[type]}
					<Command.Item
						value="{meta.label} {type}"
						onSelect={() => {
							onselect(type);
							if (!inline) open = false;
						}}
					>
						<meta.icon />
						{meta.label}
					</Command.Item>
				{/each}
			</Command.Group>
		{/each}
	</Command.List>
{/snippet}

{#if inline}
	<Command.Root class="min-h-0 flex-1 rounded-none bg-transparent">
		{@render palette()}
	</Command.Root>
{:else}
	<Command.Dialog bind:open title="커맨드 추가" description="추가할 커맨드를 검색합니다">
		{@render palette()}
	</Command.Dialog>
{/if}
