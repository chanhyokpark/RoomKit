<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { api, ApiError } from '../../api';
	import { admin } from '../../stores/admin.svelte';
	import { themeAssets } from '../../stores/theme-assets.svelte';

	let { sessionId }: { sessionId: string } = $props();

	let error = $state('');
	let ok = $state('');

	type Channel = 'bgm' | 'sfx' | 'video' | 'dialogue';
	const CHANNELS: { key: Channel; label: string }[] = [
		{ key: 'bgm', label: 'BGM' },
		{ key: 'sfx', label: '효과음' },
		{ key: 'video', label: '비디오' },
		{ key: 'dialogue', label: '대사' }
	];

	let channel = $state<Channel>('bgm');
	let mediaAssetId = $state('');
	let playerAssetId = $state('');
	let hintId = $state('');
	let hintDeviceId = $state('');
	let hintStep = $state(0);

	const mediaOptions = $derived(
		channel === 'bgm'
			? themeAssets.bgms
			: channel === 'sfx'
				? themeAssets.sfxs
				: channel === 'video'
					? themeAssets.videos
					: themeAssets.dialogues
	);

	async function command(body: unknown, label: string) {
		error = '';
		ok = '';
		try {
			await api(`/sessions/${sessionId}/command`, { method: 'POST', body });
			ok = `${label} 전송됨`;
		} catch (err) {
			error = err instanceof ApiError ? err.message : '커맨드를 실행하지 못했습니다.';
		}
	}

	function play() {
		const playerId = playerAssetId || null;
		if (channel === 'bgm') {
			void command(
				{ type: 'playBgm', bgmId: mediaAssetId, playerId, loop: false, waitUntilEnd: false },
				'BGM 재생'
			);
		} else if (channel === 'sfx') {
			void command(
				{ type: 'playSfx', sfxId: mediaAssetId, playerId, waitUntilEnd: false },
				'효과음 재생'
			);
		} else if (channel === 'video') {
			void command(
				{ type: 'playVideo', videoId: mediaAssetId, playerId, waitUntilEnd: false },
				'비디오 재생'
			);
		} else {
			void command(
				{
					type: 'playDialogue',
					dialogueId: mediaAssetId,
					playerId,
					waitUntilEnd: false,
					lineCues: []
				},
				'대사 재생'
			);
		}
	}

	function stop() {
		const body =
			channel === 'bgm'
				? { type: 'stopBgm', playerId: null, allPlayers: true }
				: channel === 'sfx'
					? { type: 'stopSfx', playerId: null, allPlayers: true }
					: channel === 'video'
						? { type: 'stopVideo', playerId: null, allPlayers: true }
						: { type: 'stopDialogue', playerId: null, allPlayers: true };
		void command(body, '정지');
	}

	async function pushHint() {
		error = '';
		ok = '';
		try {
			await api(`/sessions/${sessionId}/hint`, {
				method: 'POST',
				body: { hintId, step: hintStep }
			});
			ok = '힌트 푸시됨';
		} catch (err) {
			error = err instanceof ApiError ? err.message : '힌트를 푸시하지 못했습니다.';
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>수동 커맨드</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<!-- 재생 중 미디어 -->
		{#if admin.media && admin.media.playing.length > 0}
			<div class="flex flex-col gap-1 rounded-md border bg-card p-2">
				{#each admin.media.playing as playing (playing.commandId)}
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<Badge variant="secondary" class="text-[10px]">{playing.channel}</Badge>
						<span>{playing.assetName}</span>
						<span class="text-muted-foreground/60">{themeAssets.name(playing.deviceId)}</span>
						<Button
							variant="outline"
							size="sm"
							class="ml-auto"
							onclick={() =>
								void command(
									{
										type:
											playing.channel === 'bgm'
												? 'stopBgm'
												: playing.channel === 'sfx'
													? 'stopSfx'
													: playing.channel === 'video'
														? 'stopVideo'
														: 'stopDialogue',
										playerId: playing.playerId,
										allPlayers: false
									},
									'정지'
								)}
						>
							정지
						</Button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="flex items-center gap-2">
			<Select.Root type="single" bind:value={channel} onValueChange={() => (mediaAssetId = '')}>
				<Select.Trigger size="sm">
					{CHANNELS.find((ch) => ch.key === channel)?.label}
				</Select.Trigger>
				<Select.Content>
					{#each CHANNELS as ch (ch.key)}
						<Select.Item value={ch.key} label={ch.label}>{ch.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" bind:value={mediaAssetId}>
				<Select.Trigger size="sm" class="flex-1">
					{mediaOptions.find((a) => a.id === mediaAssetId)?.name ?? '애셋 선택'}
				</Select.Trigger>
				<Select.Content>
					{#each mediaOptions as asset (asset.id)}
						<Select.Item value={asset.id} label={asset.name}>{asset.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="single" bind:value={playerAssetId}>
				<Select.Trigger size="sm" class="w-32">
					{themeAssets.players.find((p) => p.id === playerAssetId)?.name ?? '플레이어 선택'}
				</Select.Trigger>
				<Select.Content>
					{#each themeAssets.players as playerAsset (playerAsset.id)}
						<Select.Item value={playerAsset.id} label={playerAsset.name}>
							{playerAsset.name}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button
				variant="outline"
				size="sm"
				disabled={!mediaAssetId || !playerAssetId}
				onclick={play}
			>
				재생
			</Button>
			<Button variant="outline" size="sm" onclick={stop}>전체 정지</Button>
		</div>

		<!-- 힌트 -->
		{#if themeAssets.hints.length > 0}
			<div class="flex items-center gap-2 border-t pt-3">
				<span class="text-xs text-muted-foreground">힌트</span>
				<Select.Root type="single" bind:value={hintId}>
					<Select.Trigger size="sm" class="flex-1">
						{themeAssets.hints.find((h) => h.id === hintId)?.name ?? '힌트 선택'}
					</Select.Trigger>
					<Select.Content>
						{#each themeAssets.hints as hint (hint.id)}
							<Select.Item value={hint.id} label={hint.name}>
								{hint.name}{hint.code ? ` (${hint.code})` : ''}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Input
					class="h-8 w-16 text-xs"
					type="number"
					min="0"
					bind:value={hintStep}
					title="단계 (0부터)"
				/>
				<Button variant="outline" size="sm" disabled={!hintId} onclick={() => void pushHint()}>
					푸시
				</Button>
				<Select.Root type="single" bind:value={hintDeviceId}>
					<Select.Trigger size="sm">
						{themeAssets.devices.find((d) => d.id === hintDeviceId)?.name ?? '코드 표시…'}
					</Select.Trigger>
					<Select.Content>
						{#each themeAssets.devices as device (device.id)}
							<Select.Item value={device.id} label={device.name}>{device.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					variant="outline"
					size="sm"
					disabled={!hintId || !hintDeviceId}
					onclick={() =>
						void command({ type: 'showHintCode', hintId, deviceId: hintDeviceId }, '힌트 코드 표시')}
				>
					표시
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={() =>
						void command({ type: 'hideHintCode', deviceId: null, allDevices: true }, '힌트 코드 숨김')}
				>
					모두 숨김
				</Button>
			</div>
		{/if}

		{#if ok}
			<p class="text-xs text-emerald-400">{ok}</p>
		{/if}
		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>
