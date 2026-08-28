<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
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

<Card.Root class="min-h-0">
	<Card.Header>
		<Card.Title>로그</Card.Title>
		<Card.Action>
			<Select.Root type="single" bind:value={kindFilter}>
				<Select.Trigger size="sm">
					{kindFilter === '' ? '전체' : kindFilter}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="" label="전체">전체</Select.Item>
					{#each kinds as kind (kind)}
						<Select.Item value={kind} label={kind}>{kind}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		<div class="flex max-h-96 flex-col gap-0.5 overflow-y-auto font-mono text-[11px]">
			{#if filtered.length === 0}
				<p class="text-muted-foreground/60">로그가 없습니다.</p>
			{/if}
			{#each filtered as entry (entry.id)}
				<div
					class="flex gap-2 {entry.level === 'error'
						? 'text-destructive'
						: entry.level === 'warn'
							? 'text-amber-400'
							: 'text-muted-foreground'}"
				>
					<span class="shrink-0 text-muted-foreground/60">{timeOf(entry.at)}</span>
					<span class="shrink-0 text-muted-foreground/80">[{entry.kind}]</span>
					<span class="break-all">{entry.message}</span>
				</div>
			{/each}
		</div>
	</Card.Content>
</Card.Root>
