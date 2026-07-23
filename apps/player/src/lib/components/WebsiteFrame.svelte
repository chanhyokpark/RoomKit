<script lang="ts">
	import type { RoomKitClient } from '@roomkit/client';
	import { HelperBridge } from '../bridge/helper-bridge';
	import { stage } from '../stores/stage.svelte';

	const { client }: { client: RoomKitClient | null } = $props();

	let iframe = $state<HTMLIFrameElement | null>(null);

	// A new navigate URL re-creates the iframe (via #key) and its bridge.
	$effect(() => {
		const url = stage.iframeUrl;
		if (!iframe || !url || !client) return;
		const bridge = new HelperBridge(iframe, client, url);
		return () => bridge.destroy();
	});
</script>

{#key stage.iframeUrl}
	<iframe
		bind:this={iframe}
		src={stage.iframeUrl}
		onload={() => stage.siteLoaded()}
		title="website"
		class="absolute inset-0 z-0 h-full w-full border-0 bg-black"
	></iframe>
{/key}
