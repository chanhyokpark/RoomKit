<script lang="ts">
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sidebar from '$lib/components/ui/sidebar';

	const options = [
		{ value: 'light', label: '라이트', icon: SunIcon },
		{ value: 'dark', label: '다크', icon: MoonIcon },
		{ value: 'system', label: '시스템', icon: MonitorIcon }
	] as const;

	const current = $derived(
		options.find((option) => option.value === userPrefersMode.current) ?? options[2]
	);
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Sidebar.MenuButton {...props} tooltipContent="화면 모드">
				<current.icon />
				<span>화면 모드: {current.label}</span>
			</Sidebar.MenuButton>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="top" align="start" class="w-40">
		<DropdownMenu.RadioGroup
			value={userPrefersMode.current}
			onValueChange={(value) => setMode(value as 'light' | 'dark' | 'system')}
		>
			{#each options as option (option.value)}
				<DropdownMenu.RadioItem value={option.value}>
					<option.icon class="size-4" />
					<span>{option.label}</span>
				</DropdownMenu.RadioItem>
			{/each}
		</DropdownMenu.RadioGroup>
	</DropdownMenu.Content>
</DropdownMenu.Root>
