<script lang="ts">
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import type { Asset } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { playback } from '$lib/stores/playback.svelte';
	import AssetActionsMenu from './asset-actions-menu.svelte';
	import { summarizeAsset } from './asset-summary';
	import { KIND_META } from './kinds';
	import MediaPreview from './media-preview.svelte';

	let {
		assets,
		onedit,
		ondelete
	}: {
		assets: Asset[];
		onedit: (asset: Asset) => void;
		ondelete: (asset: Asset) => void;
	} = $props();

	let previewVideo = $state<Asset | null>(null);

	function audioKey(asset: Asset): string | null {
		return asset.kind === 'bgm' || asset.kind === 'sfx' ? asset.data.fileKey : null;
	}
</script>

<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
	{#each assets as asset (asset.id)}
		{@const meta = KIND_META[asset.kind]}
		{@const playableAudio = audioKey(asset)}
		<Card.Root
			class="cursor-pointer gap-3 py-4 transition-colors hover:border-ring/50"
			onclick={() => onedit(asset)}
		>
			<Card.Header class="px-4">
				<div class="flex size-9 items-center justify-center rounded-lg bg-muted">
					<meta.icon class="size-4 text-muted-foreground" />
				</div>
				<div class="min-w-0">
					<Card.Title class="truncate">{asset.name}</Card.Title>
					<Card.Description class="truncate">
						{asset.description || summarizeAsset(asset)}
					</Card.Description>
				</div>
				<Card.Action class="flex items-center gap-1">
					{#if playableAudio}
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={(e) => {
								e.stopPropagation();
								void playback.toggle(playableAudio);
							}}
						>
							{#if playback.playingKey === playableAudio}
								<SquareIcon />
								<span class="sr-only">정지</span>
							{:else}
								<PlayIcon />
								<span class="sr-only">재생</span>
							{/if}
						</Button>
					{:else if asset.kind === 'video'}
						<Button
							variant="ghost"
							size="icon-sm"
							onclick={(e) => {
								e.stopPropagation();
								previewVideo = asset;
							}}
						>
							<PlayIcon />
							<span class="sr-only">재생</span>
						</Button>
					{/if}
					<AssetActionsMenu onedit={() => onedit(asset)} ondelete={() => ondelete(asset)} />
				</Card.Action>
			</Card.Header>
			{#if asset.tags.length > 0}
				<Card.Content class="flex flex-wrap gap-1 px-4">
					{#each asset.tags as tag (tag.id)}
						<Badge variant="outline">
							<span class="size-2 rounded-full" style:background-color={tag.color}></span>
							{tag.name}
						</Badge>
					{/each}
				</Card.Content>
			{/if}
		</Card.Root>
	{/each}
</div>

<Dialog.Root
	open={previewVideo !== null}
	onOpenChange={(open) => {
		if (!open) previewVideo = null;
	}}
>
	<Dialog.Content class="sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{previewVideo?.name}</Dialog.Title>
		</Dialog.Header>
		{#if previewVideo?.kind === 'video'}
			<MediaPreview fileKey={previewVideo.data.fileKey} media="video" />
		{/if}
	</Dialog.Content>
</Dialog.Root>
