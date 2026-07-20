<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Separator } from '$lib/components/ui/separator';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import AppSidebar from '$lib/components/app-sidebar/app-sidebar.svelte';
	import { page } from '$app/state';
	import { themesStore } from '$lib/stores/themes.svelte';

	let { children }: { children: Snippet } = $props();

	const currentTheme = $derived(themesStore.find(page.params.themeId));
	const sectionLabel = $derived(
		page.url.pathname.endsWith('/editor')
			? '에디터'
			: page.url.pathname.endsWith('/operation')
				? '운영'
				: '애셋'
	);
</script>

<Sidebar.Provider>
	<AppSidebar />
	<!-- Cap at the viewport so pages scroll in their own panes, not the body. -->
	<Sidebar.Inset class="h-svh overflow-hidden">
		<header class="flex h-14 shrink-0 items-center gap-2 border-b px-4">
			<Sidebar.Trigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-2 data-[orientation=vertical]:h-4" />
			<span class="text-sm font-medium">
				{currentTheme ? `${currentTheme.name} · ${sectionLabel}` : 'RoomKit Studio'}
			</span>
		</header>
		<div class="flex min-h-0 flex-1 flex-col">
			{@render children()}
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
