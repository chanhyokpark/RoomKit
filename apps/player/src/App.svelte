<script lang="ts">
	import Debug from './lib/components/debug/Debug.svelte';
	import Launcher from './lib/components/Launcher.svelte';
	import Stage from './lib/components/Stage.svelte';

	// Window role is fixed at creation: the main window is the launcher, stage
	// windows are opened with ?device=<id>, and player-side test runs open a
	// ?debug=<sessionId> control window. Auto-started test windows also carry
	// ?code= (+label) instead of referencing a launcher config entry.
	const params = new URLSearchParams(window.location.search);
	const deviceId = params.get('device');
	const codeOverride = params.get('code');
	const labelOverride = params.get('label');
	const debugSessionId = params.get('debug');
	const debugThemeId = params.get('theme');

	$effect(() => {
		document.body.dataset.mode = deviceId ? 'stage' : debugSessionId ? 'debug' : 'launcher';
	});
</script>

{#if deviceId}
	<Stage {deviceId} {codeOverride} {labelOverride} />
{:else if debugSessionId && debugThemeId}
	<Debug sessionId={debugSessionId} themeId={debugThemeId} />
{:else}
	<Launcher />
{/if}
