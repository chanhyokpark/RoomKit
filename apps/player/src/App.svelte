<script lang="ts">
	import Launcher from './lib/components/Launcher.svelte';
	import Stage from './lib/components/Stage.svelte';

	// Window role is fixed at creation: the main window is the launcher, stage
	// windows are opened with ?device=<config entry id>.
	const deviceId = new URLSearchParams(window.location.search).get('device');

	$effect(() => {
		document.body.dataset.mode = deviceId ? 'stage' : 'launcher';
	});
</script>

{#if deviceId}
	<Stage {deviceId} />
{:else}
	<Launcher />
{/if}
