<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SpeakerIcon from '@lucide/svelte/icons/speaker';
	import XIcon from '@lucide/svelte/icons/x';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { Command, PlayChannel, PlayingMedia } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';
	import { assetName, assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';
	import { channelLabels, formatClock, formatDuration, stripHtml } from './format.js';
	import PlayDialog from './play-dialog.svelte';
	import type { PlayerAsset } from './types.js';

	/**
	 * Media (dialogue / BGM / SFX / video) is addressed to a player, not a
	 * device, so it is listed and started here rather than on the device card.
	 */
	const { model, actions, view } = useSessionUi();
	const busyKeys = new SvelteSet<string>();
	/** Playing rows whose details are unfolded. */
	const unfolded = new SvelteSet<string>();
	/** Player whose "+" (play media) dialog is open. */
	let playDialogPlayerId = $state<string | null>(null);
	let now = $state(Date.now());

	const allDevices = $derived(assetsOf(model.assets, 'device'));
	const codeDeviceIds = $derived(new Set(model.testDeviceCodes.map((entry) => entry.deviceId)));
	// Test sessions only open the devices that got a code; mirror the devices card.
	const deviceIds = $derived(
		new Set(
			(codeDeviceIds.size > 0
				? allDevices.filter((device) => codeDeviceIds.has(device.id))
				: allDevices
			).map((device) => device.id)
		)
	);
	const players = $derived(
		assetsOf(model.assets, 'player').filter(
			(player) =>
				deviceIds.has(player.data.speakerDeviceId) || deviceIds.has(player.data.screenDeviceId)
		)
	);
	const playDialogPlayer = $derived(
		playDialogPlayerId ? (players.find((player) => player.id === playDialogPlayerId) ?? null) : null
	);
	const playingByPlayer = $derived.by(() => {
		const result = new Map<string, PlayingMedia[]>();
		for (const entry of model.media?.playing ?? []) {
			const playing = result.get(entry.playerId);
			if (playing) playing.push(entry);
			else result.set(entry.playerId, [entry]);
		}
		return result;
	});
	/** Playing entries whose player asset no longer exists (or is outside this session). */
	const orphaned = $derived(
		(model.media?.playing ?? []).filter(
			(entry) => !players.some((player) => player.id === entry.playerId)
		)
	);
	const ended = $derived(model.session?.state === 'ended');

	// Elapsed times only tick while some detail block is showing them.
	$effect(() => {
		if (unfolded.size === 0) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const stopTypes: Record<PlayChannel, Command['type']> = {
		bgm: 'stopBgm',
		sfx: 'stopSfx',
		dialogue: 'stopDialogue',
		video: 'stopVideo'
	};

	function toggleUnfolded(key: string): void {
		if (unfolded.has(key)) unfolded.delete(key);
		else unfolded.add(key);
	}

	function deviceName(deviceId: string): string {
		const device = allDevices.find((candidate) => candidate.id === deviceId);
		return device ? device.data.displayName || device.name : '(삭제됨)';
	}

	function deviceOnline(deviceId: string): boolean {
		return model.statusOf(deviceId)?.online ?? false;
	}

	/** Speaker and screen device names; collapsed to one when they are the same device. */
	function outputs(player: PlayerAsset): string {
		const { speakerDeviceId, screenDeviceId } = player.data;
		if (speakerDeviceId === screenDeviceId) return deviceName(speakerDeviceId);
		return `스피커 ${deviceName(speakerDeviceId)} · 화면 ${deviceName(screenDeviceId)}`;
	}

	function dialogueOf(entry: PlayingMedia) {
		const asset = model.assets.find((candidate) => candidate.id === entry.assetId);
		return asset?.kind === 'dialogue' ? asset : null;
	}

	/** Known total length: placeholder media (simulated) or a fully placeholder dialogue. */
	function durationOf(entry: PlayingMedia): number | null {
		const asset = model.assets.find((candidate) => candidate.id === entry.assetId);
		if (!asset) return null;
		switch (asset.kind) {
			case 'bgm':
			case 'sfx':
			case 'video':
				return asset.data.fileKey === null ? asset.data.durationMs : null;
			case 'dialogue':
				return asset.data.lines.every((line) => line.fileKey === null)
					? asset.data.lines.reduce((sum, line) => sum + line.durationMs, 0)
					: null;
			default:
				return null;
		}
	}

	function playtime(entry: PlayingMedia): string {
		const elapsed = now - entry.startedAt;
		const total = durationOf(entry);
		if (entry.loop && total !== null) {
			return `${formatDuration(elapsed % total)} / ${formatDuration(total)} (${Math.floor(elapsed / total) + 1}회차)`;
		}
		return total !== null
			? `${formatDuration(Math.min(elapsed, total))} / ${formatDuration(total)}`
			: formatDuration(elapsed);
	}

	async function run(key: string, action: () => Promise<void>): Promise<void> {
		if (busyKeys.has(key)) return;
		busyKeys.add(key);
		try {
			await action();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '요청이 실패했습니다.');
		} finally {
			busyKeys.delete(key);
		}
	}

	function stopMedia(entry: PlayingMedia): Promise<void> {
		return actions.runCommand({
			type: stopTypes[entry.channel],
			playerId: entry.playerId,
			allPlayers: false
		} as Command);
	}
</script>

{#snippet foldToggle(key: string, label: string)}
	<button
		type="button"
		class="flex min-w-0 flex-1 items-center gap-2 text-left"
		aria-expanded={unfolded.has(key)}
		onclick={() => toggleUnfolded(key)}
	>
		{#if unfolded.has(key)}
			<ChevronDownIcon class="size-3 shrink-0 text-muted-foreground" />
		{:else}
			<ChevronRightIcon class="size-3 shrink-0 text-muted-foreground" />
		{/if}
		<span class="min-w-0 truncate">{label}</span>
	</button>
{/snippet}

{#snippet detail(label: string, value: string)}
	<dt class="text-muted-foreground">{label}</dt>
	<dd class="min-w-0 break-all">{value}</dd>
{/snippet}

{#snippet playingRow(entry: PlayingMedia)}
	{@const key = `media:${entry.commandId}`}
	{@const dialogue = entry.channel === 'dialogue' ? dialogueOf(entry) : null}
	<div class="flex items-center gap-2 text-xs">
		<Badge variant="outline">{channelLabels[entry.channel]}</Badge>
		{@render foldToggle(key, assetName(model.assets, entry.assetId) ?? entry.assetName)}
		{#if entry.loop}<Badge variant="secondary">반복</Badge>{/if}
		{#if entry.channel === 'dialogue' && dialogue && entry.lineIndex !== null}
			<span class="shrink-0 text-muted-foreground">
				{entry.lineIndex + 1}/{dialogue.data.lines.length}
			</span>
		{/if}
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="재생 정지"
			disabled={busyKeys.has(`stop:${entry.commandId}`) || ended}
			onclick={() => run(`stop:${entry.commandId}`, () => stopMedia(entry))}
		>
			<XIcon />
		</Button>
	</div>
	{#if unfolded.has(key)}
		<dl
			class="ml-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs"
		>
			{@render detail('재생 시간', playtime(entry))}
			{@render detail('시작 시각', formatClock(entry.startedAt))}
			{@render detail('디바이스', deviceName(entry.deviceId))}
			{#if entry.channel === 'bgm'}
				{@render detail('반복', entry.loop ? '켜짐' : '꺼짐')}
			{/if}
			{#if entry.channel === 'dialogue'}
				{@render detail(
					'현재 라인',
					dialogue
						? entry.lineIndex === null
							? `시작 대기 (${dialogue.data.lines.length}줄)`
							: `${entry.lineIndex + 1} / ${dialogue.data.lines.length}`
						: entry.lineIndex === null
							? '시작 대기'
							: String(entry.lineIndex + 1)
				)}
				{#if dialogue && dialogue.data.lines.length > 0}
					<ol
						class="col-span-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded border bg-background p-1.5"
					>
						{#each dialogue.data.lines as line, index (line.id)}
							{@const active = index === entry.lineIndex}
							<li
								class={cn(
									'flex items-center gap-2 rounded px-1.5 py-0.5',
									active ? 'bg-muted font-medium' : 'text-muted-foreground'
								)}
							>
								<span class="w-5 shrink-0 text-right font-mono">{index + 1}</span>
								<span class="min-w-0 truncate">
									{stripHtml(line.subtitleHtml) || '(자막 없음)'}
								</span>
								{#if active}<Badge variant="outline" class="ml-auto">재생 중</Badge>{/if}
							</li>
						{/each}
					</ol>
				{/if}
			{/if}
			{@render detail('명령 ID', entry.commandId)}
		</dl>
	{/if}
{/snippet}

{#if !view.simple}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><SpeakerIcon />플레이어</Card.Title>
			<Card.Description>
				재생 중인 대사·BGM·효과음·비디오를 확인하고, + 버튼으로 미디어를 재생합니다.
			</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-2.5">
			{#if players.length === 0 && orphaned.length === 0}
				<p class="text-sm text-muted-foreground">이 세션에 플레이어가 없습니다.</p>
			{/if}
			{#each players as player (player.id)}
				{@const currentMedia = playingByPlayer.get(player.id) ?? []}
				{@const online =
					deviceOnline(player.data.speakerDeviceId) && deviceOnline(player.data.screenDeviceId)}
				<div class="rounded-md border">
					<div class="flex items-center gap-2 px-3 py-2">
						<span class={cn('size-2 shrink-0 rounded-full', online ? 'bg-primary' : 'bg-muted')}
						></span>
						<span class="truncate text-sm font-medium">{player.name}</span>
						<span class="min-w-0 truncate text-xs text-muted-foreground">{outputs(player)}</span>
						{#if currentMedia.length > 0}
							<Badge variant="outline" class="ml-auto">재생 {currentMedia.length}</Badge>
						{/if}
						<Button
							variant="outline"
							size="icon-sm"
							class={currentMedia.length > 0 ? '' : 'ml-auto'}
							aria-label="미디어 재생"
							title="미디어 재생"
							disabled={ended}
							onclick={() => (playDialogPlayerId = player.id)}
						>
							<PlusIcon />
						</Button>
					</div>
					{#if currentMedia.length > 0}
						<div class="flex flex-col gap-1.5 border-t px-3 py-2">
							{#each currentMedia as entry (entry.commandId)}
								{@render playingRow(entry)}
							{/each}
						</div>
					{/if}
				</div>
			{/each}
			{#if orphaned.length > 0}
				<div class="rounded-md border">
					<div class="flex items-center gap-2 px-3 py-2">
						<span class="truncate text-sm font-medium text-muted-foreground">(삭제된 플레이어)</span
						>
					</div>
					<div class="flex flex-col gap-1.5 border-t px-3 py-2">
						{#each orphaned as entry (entry.commandId)}
							{@render playingRow(entry)}
						{/each}
					</div>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if playDialogPlayer}
		<PlayDialog
			player={playDialogPlayer}
			bind:open={
				() => playDialogPlayerId !== null,
				(value) => {
					if (!value) playDialogPlayerId = null;
				}
			}
		/>
	{/if}
{/if}
