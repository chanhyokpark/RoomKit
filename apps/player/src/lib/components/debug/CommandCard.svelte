<script lang="ts">
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

	const btn =
		'rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs hover:bg-neutral-800 disabled:opacity-40';
	const input =
		'rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs outline-none focus:border-neutral-400';
</script>

<section class="flex flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900/60 p-4">
	<h2 class="text-sm font-medium text-neutral-300">수동 커맨드</h2>

	<!-- 재생 중 미디어 -->
	{#if admin.media && admin.media.playing.length > 0}
		<div class="flex flex-col gap-1 rounded-md border border-neutral-800 bg-neutral-900/80 p-2">
			{#each admin.media.playing as playing (playing.commandId)}
				<div class="flex items-center gap-2 text-xs text-neutral-400">
					<span class="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px]">{playing.channel}</span>
					<span>{playing.assetName}</span>
					<span class="text-neutral-600">{themeAssets.name(playing.deviceId)}</span>
					<button
						class="{btn} ml-auto"
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
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<div class="flex items-center gap-2">
		<select class={input} bind:value={channel} onchange={() => (mediaAssetId = '')}>
			{#each CHANNELS as ch (ch.key)}
				<option value={ch.key}>{ch.label}</option>
			{/each}
		</select>
		<select class="{input} flex-1" bind:value={mediaAssetId}>
			<option value="">애셋 선택</option>
			{#each mediaOptions as asset (asset.id)}
				<option value={asset.id}>{asset.name}</option>
			{/each}
		</select>
		<select class="{input} w-32" bind:value={playerAssetId}>
			<option value="">플레이어 선택</option>
			{#each themeAssets.players as playerAsset (playerAsset.id)}
				<option value={playerAsset.id}>{playerAsset.name}</option>
			{/each}
		</select>
		<button class={btn} disabled={!mediaAssetId || !playerAssetId} onclick={play}>재생</button>
		<button class={btn} onclick={stop}>전체 정지</button>
	</div>

	<!-- 힌트 -->
	{#if themeAssets.hints.length > 0}
		<div class="flex items-center gap-2 border-t border-neutral-800 pt-3">
			<span class="text-xs text-neutral-400">힌트</span>
			<select class="{input} flex-1" bind:value={hintId}>
				<option value="">힌트 선택</option>
				{#each themeAssets.hints as hint (hint.id)}
					<option value={hint.id}>{hint.name}{hint.code ? ` (${hint.code})` : ''}</option>
				{/each}
			</select>
			<input class="{input} w-16" type="number" min="0" bind:value={hintStep} title="단계 (0부터)" />
			<button class={btn} disabled={!hintId} onclick={() => void pushHint()}>푸시</button>
			<select class={input} bind:value={hintDeviceId}>
				<option value="">코드 표시…</option>
				{#each themeAssets.devices as device (device.id)}
					<option value={device.id}>{device.name}</option>
				{/each}
			</select>
			<button
				class={btn}
				disabled={!hintId || !hintDeviceId}
				onclick={() =>
					void command({ type: 'showHintCode', hintId, deviceId: hintDeviceId }, '힌트 코드 표시')}
			>
				표시
			</button>
			<button
				class={btn}
				onclick={() =>
					void command({ type: 'hideHintCode', deviceId: null, allDevices: true }, '힌트 코드 숨김')}
			>
				모두 숨김
			</button>
		</div>
	{/if}

	{#if ok}
		<p class="text-xs text-emerald-400">{ok}</p>
	{/if}
	{#if error}
		<p class="text-xs text-red-400">{error}</p>
	{/if}
</section>
