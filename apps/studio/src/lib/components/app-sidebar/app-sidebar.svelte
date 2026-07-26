<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import BoxesIcon from '@lucide/svelte/icons/boxes';
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MonitorPlayIcon from '@lucide/svelte/icons/monitor-play';
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import logo from '$lib/assets/favicon.svg';
	import { auth } from '$lib/stores/auth.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';
	import ThemeSwitcher from './theme-switcher.svelte';

	const activeThemeId = $derived(page.params.themeId ?? themesStore.themes[0]?.id);
	const inEditor = $derived(page.url.pathname.endsWith('/editor'));
	const inOperation = $derived(page.url.pathname.endsWith('/operation'));
	const inWebsiteTest = $derived(page.url.pathname.endsWith('/website-test'));

	function handleLogout() {
		auth.logout();
		void goto(resolve('/login'));
	}
</script>

<Sidebar.Root>
	<Sidebar.Header>
		<div class="flex items-center gap-2 px-2 py-1.5">
			<img src={logo} alt="RoomKit" class="size-8 shrink-0 rounded-lg" />
			<div class="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
				<span class="text-sm font-semibold">RoomKit</span>
				<span class="text-xs text-muted-foreground">Studio</span>
			</div>
		</div>
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
								isActive={page.params.themeId !== undefined &&
									!inEditor &&
									!inOperation &&
									!inWebsiteTest}
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
					<Sidebar.MenuItem>
						{#if activeThemeId}
							<Sidebar.MenuButton isActive={inWebsiteTest}>
								{#snippet child({ props })}
									<a
										href={resolve('/(app)/themes/[themeId]/website-test', {
											themeId: activeThemeId
										})}
										{...props}
									>
										<FlaskConicalIcon />
										<span>웹 테스트</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						{:else}
							<Sidebar.MenuButton aria-disabled="true" class="pointer-events-none opacity-50">
								<FlaskConicalIcon />
								<span>웹 테스트</span>
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
