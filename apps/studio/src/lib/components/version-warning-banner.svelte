<script lang="ts">
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';

	let { warnings }: { warnings: string[] } = $props();
</script>

{#if warnings.length > 0}
	<div
		class="flex shrink-0 flex-col gap-0.5 border-b bg-amber-100 px-4 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
	>
		{#each warnings as warning (warning)}
			<div class="flex items-center gap-2">
				<TriangleAlertIcon class="size-4 shrink-0" />
				<span>{warning}</span>
			</div>
		{/each}
	</div>
{/if}
