<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { config } from '../stores/config.svelte';
	import { connection } from '../stores/connection.svelte';
	import ConnectionBadge from './ConnectionBadge.svelte';

	const { deviceId }: { deviceId: string } = $props();

	const device = $derived(config.deviceById(deviceId));

	onMount(() => {
		if (device) {
			connection.start(config.serverUrl, device.deviceCode, device.label);
		}
	});

	onDestroy(() => connection.stop());
</script>

{#if !device}
	<div class="flex h-full items-center justify-center text-neutral-500">
		알 수 없는 디바이스입니다. 런처에서 다시 열어주세요.
	</div>
{:else}
	<div class="relative h-full w-full bg-black">
		<ConnectionBadge />
	</div>
{/if}
