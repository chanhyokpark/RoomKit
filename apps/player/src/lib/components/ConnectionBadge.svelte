<script lang="ts">
	import { connection } from '../stores/connection.svelte';

	// Production rooms shouldn't see UI chrome: show nothing while connected,
	// a small dot + reason otherwise (operators watch the dashboard instead).
	const color = $derived(
		connection.status === 'connected'
			? 'bg-green-500'
			: connection.status === 'error'
				? 'bg-red-500'
				: 'bg-yellow-500'
	);
</script>

{#if connection.status !== 'connected'}
	<div
		class="absolute right-3 bottom-3 z-50 flex items-center gap-2 rounded-full bg-neutral-900/80 px-3 py-1.5 text-xs text-neutral-300"
	>
		<span class="inline-block h-2 w-2 rounded-full {color}"></span>
		{connection.status}{connection.detail ? ` — ${connection.detail}` : ''}
	</div>
{/if}
