<script lang="ts">
	import { page } from '$app/state';
	import OperationWorkspace from '$lib/components/operation/operation-workspace.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';

	const themeId = $derived(page.params.themeId!);
	const theme = $derived(themesStore.find(themeId));
</script>

<svelte:head><title>{theme ? `${theme.name} · 운영` : '운영'} · RoomKit Studio</title></svelte:head>

{#key themeId}
	<OperationWorkspace {themeId} />
{/key}
