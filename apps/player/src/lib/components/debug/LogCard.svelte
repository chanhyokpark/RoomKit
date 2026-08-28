<script lang="ts">
	import { admin } from '../../stores/admin.svelte';

	let kindFilter = $state('');

	const kinds = $derived([...new Set(admin.logs.map((l) => l.kind))].sort());
	const filtered = $derived(
		kindFilter === '' ? admin.logs : admin.logs.filter((l) => l.kind === kindFilter)
	);

	function timeOf(at: Date): string {
		return at.toLocaleTimeString('ko-KR', { hour12: false });
	}
</script>

<section class="flex min-h-0 flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-neutral-300">로그</h2>
		<select
			class="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs outline-none"
			bind:value={kindFilter}
		>
			<option value="">전체</option>
			{#each kinds as kind (kind)}
				<option value={kind}>{kind}</option>
			{/each}
		</select>
	</div>
	<div class="flex max-h-96 flex-col gap-0.5 overflow-y-auto font-mono text-[11px]">
		{#if filtered.length === 0}
			<p class="text-neutral-600">로그가 없습니다.</p>
		{/if}
		{#each filtered as entry (entry.id)}
			<div
				class="flex gap-2 {entry.level === 'error'
					? 'text-red-400'
					: entry.level === 'warn'
						? 'text-amber-400'
						: 'text-neutral-400'}"
			>
				<span class="shrink-0 text-neutral-600">{timeOf(entry.at)}</span>
				<span class="shrink-0 text-neutral-500">[{entry.kind}]</span>
				<span class="break-all">{entry.message}</span>
			</div>
		{/each}
	</div>
</section>
