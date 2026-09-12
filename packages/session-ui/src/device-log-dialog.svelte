<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { toast } from 'svelte-sonner';
	import type { DeviceLogLine } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { useSessionUi } from './context.js';
	import type { DeviceAsset } from './types.js';

	/**
	 * The player log of one device window: what the player uploaded over its
	 * socket (console output, socket trace, uncaught errors), merged from the
	 * REST backfill fetched on open and the live admin feed.
	 */
	let { device, open = $bindable(false) }: { device: DeviceAsset; open?: boolean } = $props();

	const { model, actions } = useSessionUi();

	const LEVELS: Array<{ value: string; label: string; min: number }> = [
		{ value: 'all', label: '전체', min: 0 },
		{ value: 'warn', label: '경고 이상', min: 2 },
		{ value: 'error', label: '오류만', min: 3 }
	];
	const LEVEL_RANK: Record<DeviceLogLine['level'], number> = {
		debug: 0,
		info: 1,
		warn: 2,
		error: 3
	};

	let levelFilter = $state('all');
	let search = $state('');
	let loading = $state(false);
	let backfill = $state<DeviceLogLine[]>([]);
	let list = $state<HTMLDivElement | null>(null);

	/** Backfill ∪ live, by seq; a reconnecting device restarts seq (server buffer), so key on both. */
	const lines = $derived.by(() => {
		const bySeq = new Map<number, DeviceLogLine>();
		for (const line of backfill) bySeq.set(line.seq, line);
		for (const line of model.deviceLogsOf(device.id)) bySeq.set(line.seq, line);
		return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
	});
	const filtered = $derived.by(() => {
		const min = LEVELS.find((level) => level.value === levelFilter)?.min ?? 0;
		const needle = search.trim().toLowerCase();
		return lines.filter(
			(line) =>
				LEVEL_RANK[line.level] >= min &&
				(needle === '' || line.message.toLowerCase().includes(needle))
		);
	});
	const errorCount = $derived(lines.filter((line) => line.level === 'error').length);

	$effect(() => {
		if (!open) return;
		loading = true;
		void actions
			.getDeviceLogs(device.id)
			.then((rows) => (backfill = rows))
			.catch(() => toast.error('디바이스 로그를 불러오지 못했습니다.'))
			.finally(() => (loading = false));
	});

	// Follow the tail while open and new lines arrive.
	$effect(() => {
		if (!open || !list) return;
		void filtered.length;
		list.scrollTop = list.scrollHeight;
	});

	function timeOf(at: number): string {
		return new Date(at).toLocaleTimeString('ko-KR', { hour12: false });
	}

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(
				filtered.map((line) => `${timeOf(line.at)} [${line.level}] ${line.message}`).join('\n')
			);
			toast.success(`로그 ${filtered.length}줄을 복사했습니다.`);
		} catch {
			toast.error('클립보드에 접근하지 못했습니다.');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col sm:max-w-4xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{device.data.displayName || device.name} 플레이어 로그
				{#if errorCount > 0}<Badge variant="destructive">오류 {errorCount}</Badge>{/if}
			</Dialog.Title>
		</Dialog.Header>

		<div class="flex flex-wrap items-center gap-2">
			<Select.Root type="single" bind:value={levelFilter}>
				<Select.Trigger size="sm" class="w-28" aria-label="로그 레벨">
					{LEVELS.find((level) => level.value === levelFilter)?.label}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each LEVELS as level (level.value)}
							<Select.Item value={level.value} label={level.label}>{level.label}</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			<Input
				class="h-8 min-w-40 flex-1"
				placeholder="검색"
				aria-label="로그 검색"
				bind:value={search}
			/>
			<Button size="sm" variant="outline" disabled={filtered.length === 0} onclick={copy}>
				<CopyIcon data-icon="inline-start" />복사
			</Button>
		</div>

		<div
			bind:this={list}
			class="min-h-60 flex-1 overflow-auto rounded-md border bg-muted/40 p-2 font-mono text-xs"
		>
			{#if loading && lines.length === 0}
				<p class="text-muted-foreground">불러오는 중…</p>
			{:else if filtered.length === 0}
				<p class="text-muted-foreground">
					{lines.length === 0
						? '아직 이 디바이스가 보낸 로그가 없습니다.'
						: '조건에 맞는 로그가 없습니다.'}
				</p>
			{/if}
			{#each filtered as line (line.seq)}
				<div
					class={cn(
						'flex gap-2 break-all whitespace-pre-wrap',
						line.level === 'error'
							? 'text-destructive'
							: line.level === 'warn'
								? 'text-amber-600 dark:text-amber-400'
								: line.level === 'debug'
									? 'text-muted-foreground'
									: ''
					)}
				>
					<span class="shrink-0 text-muted-foreground">{timeOf(line.at)}</span>
					<span class="min-w-0">{line.message}</span>
				</div>
			{/each}
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>닫기</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
