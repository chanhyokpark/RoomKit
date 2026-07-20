<script lang="ts">
	import { page } from '$app/state';
	import EditorWorkspace from '$lib/components/editor/editor-workspace.svelte';
	import { themesStore } from '$lib/stores/themes.svelte';

	const themeId = $derived(page.params.themeId!);
	const theme = $derived(themesStore.find(themeId));
</script>

<svelte:head
	><title>{theme ? `${theme.name} · 에디터` : '에디터'} · RoomKit Studio</title></svelte:head
>

{#key themeId}
	<EditorWorkspace {themeId} />
{/key}
