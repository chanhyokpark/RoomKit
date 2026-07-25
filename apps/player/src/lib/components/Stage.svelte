<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { cache } from '../cache/manager.svelte';
	import { PlaybackEngine } from '../playback/engine';
	import { startKiosk } from '../kiosk';
	import { config } from '../stores/config.svelte';
	import { connection } from '../stores/connection.svelte';
	import { stage } from '../stores/stage.svelte';
	import ConnectionBadge from './ConnectionBadge.svelte';
	import HintCodeOverlay from './HintCodeOverlay.svelte';
	import PlaceholderOverlay from './PlaceholderOverlay.svelte';
	import SubtitleOverlay from './SubtitleOverlay.svelte';
	import TestOverlay from './TestOverlay.svelte';
	import WebsiteFrame from './WebsiteFrame.svelte';

	const {
		deviceId,
		codeOverride = null,
		labelOverride = null
	}: { deviceId: string; codeOverride?: string | null; labelOverride?: string | null } = $props();

	// Auto-started test windows carry their code in the URL; launcher-opened
	// windows look their entry up in the shared config.
	const device = $derived(
		codeOverride
			? {
					id: deviceId,
					label: labelOverride ?? deviceId,
					deviceCode: codeOverride,
					kiosk: false
				}
			: config.deviceById(deviceId)
	);

	let engine = $state<PlaybackEngine | null>(null);

	/** Video surface placement; null frame = fullscreen. */
	const videoFrameStyle = $derived(
		stage.videoFrame
			? `left:${stage.videoFrame.x}%;top:${stage.videoFrame.y}%;width:${stage.videoFrame.width}%;height:${stage.videoFrame.height}%`
			: 'inset:0'
	);

	// Hide the cursor while a real video plays; test sessions keep it so the
	// overlay's skip buttons stay clickable.
	$effect(() => {
		document.body.classList.toggle('video-playing', !!stage.videoSrc && !connection.isTest);
		return () => document.body.classList.remove('video-playing');
	});

	onMount(() => {
		if (!device) return;
		const client = connection.start(config.serverUrl, device.deviceCode, device.label);
		engine = new PlaybackEngine(client);
		// Pre-download this device's media; re-sync on every (re)welcome.
		void cache.init().then(() => {
			client.on('welcome', () => void cache.sync(client));
			// welcome may have raced ahead of init — sync() serializes itself.
			if (connection.welcome) void cache.sync(client);
		});
		if (device.kiosk) return startKiosk();
	});

	onDestroy(() => {
		engine?.resetAll();
		connection.stop();
	});
</script>

{#if !device}
	<div class="flex h-full items-center justify-center text-neutral-500">
		알 수 없는 디바이스입니다. 런처에서 다시 열어주세요.
	</div>
{:else}
	<div class="relative h-full w-full overflow-hidden bg-black">
		{#if stage.iframeUrl}
			<WebsiteFrame client={connection.client} />
		{/if}
		{#if stage.videoSrc}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="absolute z-10 bg-black object-contain"
				style={videoFrameStyle}
				src={stage.videoSrc}
				autoplay
				onended={() => engine?.video.handleEnded()}
				onerror={() => engine?.video.handleError()}
			></video>
		{/if}
		<PlaceholderOverlay />
		<SubtitleOverlay />
		<HintCodeOverlay />
		{#if connection.isTest}
			<TestOverlay />
		{/if}
		<ConnectionBadge />
	</div>
{/if}
