<script lang="ts">
	import { page } from '$app/state';
	import AssetManager from '$lib/components/assets/asset-manager.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';

	const themeId = $derived(page.params.themeId!);
	const theme = $derived(themesStore.find(themeId));
</script>

<svelte:head><title>{theme ? `${theme.name} · 애셋` : '애셋'} · RoomKit Studio</title></svelte:head>

{#key themeId}
	<AssetManager {themeId} />
{/key}
