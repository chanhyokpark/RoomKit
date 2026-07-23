<script lang="ts">
	import Launcher from './lib/components/Launcher.svelte';
	import Stage from './lib/components/Stage.svelte';

	// Window role is fixed at creation: the main window is the launcher, stage
	// windows are opened with ?device=<id>. Auto-started test windows also
	// carry ?code= (+label) instead of referencing a launcher config entry.
	const params = new URLSearchParams(window.location.search);
	const deviceId = params.get('device');
	const codeOverride = params.get('code');
	const labelOverride = params.get('label');

	$effect(() => {
		document.body.dataset.mode = deviceId ? 'stage' : 'launcher';
	});
</script>

{#if deviceId}
	<Stage {deviceId} {codeOverride} {labelOverride} />
{:else}
	<Launcher />
{/if}
