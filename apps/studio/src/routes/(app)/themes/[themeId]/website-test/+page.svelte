<script lang="ts">
	import { page } from '$app/state';
	import WebsiteTestWorkspace from '$lib/components/website-test/website-test-workspace.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';

	const themeId = $derived(page.params.themeId!);
	const theme = $derived(themesStore.find(themeId));
</script>

<svelte:head>
	<title>{theme ? `${theme.name} · 웹 테스트` : '웹 테스트'} · RoomKit Studio</title>
</svelte:head>

{#key themeId}
	<WebsiteTestWorkspace {themeId} />
{/key}
