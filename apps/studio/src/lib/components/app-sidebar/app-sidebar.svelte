<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BoxesIcon from '@lucide/svelte/icons/boxes';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MonitorPlayIcon from '@lucide/svelte/icons/monitor-play';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import { auth } from '$lib/stores/auth.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';
	import ThemeSwitcher from './theme-switcher.svelte';

	const activeThemeId = $derived(page.params.themeId ?? themesStore.themes[0]?.id);
	const inEditor = $derived(page.url.pathname.endsWith('/editor'));
	const inOperation = $derived(page.url.pathname.endsWith('/operation'));

	function handleLogout() {
		auth.logout();
		void goto(resolve('/login'));
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<ThemeSwitcher />
	</Sidebar.Header>
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupLabel>메뉴</Sidebar.GroupLabel>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						{#if activeThemeId}
							<Sidebar.MenuButton
								isActive={page.params.themeId !== undefined && !inEditor && !inOperation}
							>
								{#snippet child({ props })}
									<a
										href={resolve('/(app)/themes/[themeId]', { themeId: activeThemeId })}
										{...props}
									>
										<BoxesIcon />
										<span>애셋</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						{:else}
							<Sidebar.MenuButton aria-disabled="true" class="pointer-events-none opacity-50">
								<BoxesIcon />
								<span>애셋</span>
							</Sidebar.MenuButton>
						{/if}
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						{#if activeThemeId}
							<Sidebar.MenuButton isActive={inEditor}>
								{#snippet child({ props })}
									<a
										href={resolve('/(app)/themes/[themeId]/editor', { themeId: activeThemeId })}
										{...props}
									>
										<WorkflowIcon />
										<span>에디터</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						{:else}
							<Sidebar.MenuButton aria-disabled="true" class="pointer-events-none opacity-50">
								<WorkflowIcon />
								<span>에디터</span>
							</Sidebar.MenuButton>
						{/if}
					</Sidebar.MenuItem>
					<Sidebar.MenuItem>
						{#if activeThemeId}
							<Sidebar.MenuButton isActive={inOperation}>
								{#snippet child({ props })}
									<a
										href={resolve('/(app)/themes/[themeId]/operation', { themeId: activeThemeId })}
										{...props}
									>
										<MonitorPlayIcon />
										<span>운영</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						{:else}
							<Sidebar.MenuButton aria-disabled="true" class="pointer-events-none opacity-50">
								<MonitorPlayIcon />
								<span>운영</span>
							</Sidebar.MenuButton>
						{/if}
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton onclick={handleLogout}>
					<LogOutIcon />
					<span>로그아웃</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
