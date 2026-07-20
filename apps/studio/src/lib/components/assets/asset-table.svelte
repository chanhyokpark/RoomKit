<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import type { Asset } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Table from '$lib/components/ui/table';
	import { playback } from '$lib/stores/playback.svelte';
	import AssetActionsMenu from './asset-actions-menu.svelte';
	import { summarizeAsset } from './asset-summary';

	let {
		assets,
		onedit,
		ondelete
	}: {
		assets: Asset[];
		onedit: (asset: Asset) => void;
		ondelete: (asset: Asset) => void;
	} = $props();

	const hasCode = $derived(assets.some((asset) => asset.code !== null));
	const expandable = $derived(assets.some((asset) => asset.kind === 'dialogue'));
	let expandedId = $state<string | null>(null);

	function stripHtml(html: string): string {
		return html.replace(/<[^>]*>/g, '');
	}
</script>

<div class="overflow-x-auto rounded-lg border">
	<Table.Root>
		<Table.Header>
			<Table.Row>
				{#if expandable}
					<Table.Head class="w-10"><span class="sr-only">라인 열기</span></Table.Head>
				{/if}
				<Table.Head>이름</Table.Head>
				{#if hasCode}
					<Table.Head class="w-24">코드</Table.Head>
				{/if}
				<Table.Head>정보</Table.Head>
				<Table.Head>태그</Table.Head>
				<Table.Head class="w-12"><span class="sr-only">동작</span></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each assets as asset (asset.id)}
				<Table.Row class="cursor-pointer" onclick={() => onedit(asset)}>
					{#if expandable}
						<Table.Cell>
							{#if asset.kind === 'dialogue' && asset.data.lines.length > 0}
								<Button
									variant="ghost"
									size="icon-sm"
									onclick={(e) => {
										e.stopPropagation();
										expandedId = expandedId === asset.id ? null : asset.id;
									}}
								>
									{#if expandedId === asset.id}
										<ChevronDownIcon />
									{:else}
										<ChevronRightIcon />
									{/if}
									<span class="sr-only">라인 목록 열기</span>
								</Button>
							{/if}
						</Table.Cell>
					{/if}
					<Table.Cell class="max-w-48 font-medium">
						<div class="truncate">{asset.name}</div>
						{#if asset.description}
							<div class="truncate text-xs font-normal text-muted-foreground">
								{asset.description}
							</div>
						{/if}
					</Table.Cell>
					{#if hasCode}
						<Table.Cell class="font-mono">{asset.code}</Table.Cell>
					{/if}
					<Table.Cell class="max-w-64 truncate text-muted-foreground">
						{summarizeAsset(asset)}
					</Table.Cell>
					<Table.Cell>
						<div class="flex flex-wrap gap-1">
							{#each asset.tags as tag (tag.id)}
								<Badge variant="outline">
									<span class="size-2 rounded-full" style:background-color={tag.color}></span>
									{tag.name}
								</Badge>
							{/each}
						</div>
					</Table.Cell>
					<Table.Cell>
						<AssetActionsMenu onedit={() => onedit(asset)} ondelete={() => ondelete(asset)} />
					</Table.Cell>
				</Table.Row>
				{#if asset.kind === 'dialogue' && expandedId === asset.id}
					<Table.Row class="bg-muted/30 hover:bg-muted/30">
						<Table.Cell colspan={hasCode ? 6 : 5} class="py-2">
							<ul class="flex flex-col gap-1">
								{#each asset.data.lines as line, index (line.id)}
									<li class="flex items-center gap-2">
										<Button
											variant="ghost"
											size="icon-sm"
											onclick={() => void playback.toggle(line.fileKey)}
										>
											{#if playback.playingKey === line.fileKey}
												<SquareIcon />
												<span class="sr-only">정지</span>
											{:else}
												<PlayIcon />
												<span class="sr-only">라인 {index + 1} 재생</span>
											{/if}
										</Button>
										<span class="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">
											{index + 1}
										</span>
										<span class="truncate text-sm text-muted-foreground">
											{stripHtml(line.subtitleHtml) || line.fileKey.split('/').at(-1)}
										</span>
									</li>
								{/each}
							</ul>
						</Table.Cell>
					</Table.Row>
				{/if}
			{/each}
		</Table.Body>
	</Table.Root>
</div>
