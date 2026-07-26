<!-- Console-style expandable JSON tree (recursive via self-import). -->
<script lang="ts">
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { JsonValue } from '@roomkit/shared';
	import JsonView from './json-view.svelte';

	let { value, label, depth = 0 }: { value: JsonValue; label?: string; depth?: number } = $props();

	// Open state intentionally seeds from the initial depth only.
	// svelte-ignore state_referenced_locally
	let open = $state(depth < 1);

	const isObject = $derived(value !== null && typeof value === 'object' && !Array.isArray(value));
	const isArray = $derived(Array.isArray(value));
	const entries = $derived(
		isArray
			? (value as JsonValue[]).map((item, index) => [String(index), item] as const)
			: isObject
				? Object.entries(value as Record<string, JsonValue>)
				: []
	);

	function preview(val: JsonValue): string {
		if (Array.isArray(val)) return `Array(${val.length})`;
		if (val !== null && typeof val === 'object') {
			const keys = Object.keys(val);
			const shown = keys.slice(0, 3).join(', ');
			return `{${shown}${keys.length > 3 ? ', …' : ''}}`;
		}
		return '';
	}
</script>

{#if (isObject || isArray) && entries.length > 0}
	<div class="flex flex-col">
		<button
			type="button"
			class="flex items-center gap-0.5 rounded px-0.5 text-left hover:bg-muted"
			onclick={() => (open = !open)}
		>
			<ChevronRightIcon
				class="size-3 shrink-0 text-muted-foreground transition-transform {open ? 'rotate-90' : ''}"
			/>
			{#if label !== undefined}
				<span class="text-violet-700 dark:text-violet-400">{label}:</span>
			{/if}
			<span class="ml-1 text-muted-foreground">{preview(value)}</span>
		</button>
		{#if open}
			<div class="ml-1.5 flex flex-col border-l border-border pl-3">
				{#each entries as [key, child] (key)}
					<JsonView value={child} label={key} depth={depth + 1} />
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<div class="flex items-baseline gap-1 px-0.5">
		{#if label !== undefined}
			<span class="text-violet-700 dark:text-violet-400">{label}:</span>
		{/if}
		{#if typeof value === 'string'}
			<span class="break-all whitespace-pre-wrap text-emerald-700 dark:text-emerald-400"
				>"{value}"</span
			>
		{:else if typeof value === 'number'}
			<span class="text-sky-700 dark:text-sky-400">{value}</span>
		{:else if typeof value === 'boolean'}
			<span class="text-amber-700 dark:text-amber-400">{String(value)}</span>
		{:else if value === null}
			<span class="text-muted-foreground">null</span>
		{:else}
			<!-- Empty object/array -->
			<span class="text-muted-foreground">{isArray ? '[]' : '{}'}</span>
		{/if}
	</div>
{/if}
