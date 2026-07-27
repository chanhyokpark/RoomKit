<script lang="ts">
	import FlaskConicalIcon from '@lucide/svelte/icons/flask-conical';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { PUBLIC_API_URL } from '$env/static/public';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { versionWarning } from '$lib/version';
	import { normalizeUrl, useWebsiteTestData } from './website-test-data.svelte';

	const data = useWebsiteTestData();

	const memory = data.loadSetup();

	// Writable deriveds: default to the last-used setup (or the first option),
	// user picks override, and a selected player that disconnects falls back
	// automatically on the next players change.
	let playerId = $derived.by<string | null>(() => {
		if (memory.playerId && data.playersById.has(memory.playerId)) return memory.playerId;
		return data.players[0]?.playerId ?? null;
	});
	let deviceId = $derived.by<string | null>(() => {
		if (memory.deviceId && data.devices.some((d) => d.id === memory.deviceId)) {
			return memory.deviceId;
		}
		return data.devices[0]?.id ?? null;
	});
	let url = $state(memory.url ?? '');
	let busy = $state(false);

	const selectedPlayer = $derived(playerId === null ? null : data.playersById.get(playerId));
	const selectedDevice = $derived(data.devices.find((d) => d.id === deviceId));
	const playerVersionWarning = $derived(
		selectedPlayer
			? versionWarning('player', selectedPlayer.version, `플레이어 "${selectedPlayer.playerName}"`)
			: null
	);

	function websiteUrl(assetId: string): string {
		const website = data.websites.find((w) => w.id === assetId);
		if (!website) return '';
		return website.data.mode === 'hosted'
			? `${PUBLIC_API_URL}/api/sites/${website.id}/`
			: website.data.url;
	}

	const validationError = $derived.by(() => {
		if (data.players.length === 0) return '연결된 플레이어가 없습니다. 플레이어 앱을 실행하세요.';
		if (playerId === null) return '플레이어를 선택하세요.';
		if (deviceId === null) return '장치를 선택하세요.';
		if (normalizeUrl(url) === '') return '테스트할 웹사이트 URL을 입력하세요.';
		return null;
	});

	async function handleStart(): Promise<void> {
		if (busy || validationError || !playerId || !deviceId) return;
		busy = true;
		try {
			await data.start({ playerId, deviceId, url: normalizeUrl(url) });
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root class="mx-auto w-full max-w-lg">
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<FlaskConicalIcon class="size-4" />
			웹 테스트 시작
		</Card.Title>
		<Card.Description>
			플레이어의 장치 창을 임의의 URL(예: 개발 중인 localhost 사이트)로 열고, 커맨드와 이벤트를
			수동으로 실행해 웹사이트를 테스트합니다. 아무것도 저장되지 않습니다.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<span class="text-xs text-muted-foreground">플레이어</span>
			<Select.Root
				type="single"
				value={playerId ?? ''}
				onValueChange={(value) => (playerId = value === '' ? null : value)}
				disabled={data.players.length === 0}
			>
				<Select.Trigger class="w-full" aria-label="플레이어">
					{#if selectedPlayer}
						<span class="flex items-center gap-2">
							<MonitorIcon class="size-4" />
							{selectedPlayer.playerName}
						</span>
					{:else}
						<span class="text-muted-foreground">
							{data.players.length === 0 ? '연결된 플레이어 없음' : '선택'}
						</span>
					{/if}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each data.players as player (player.playerId)}
							<Select.Item value={player.playerId} label={player.playerName}>
								{player.playerName}
							</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
			{#if playerVersionWarning}
				<p class="text-xs text-amber-600 dark:text-amber-500">{playerVersionWarning}</p>
			{/if}
		</div>
		<div class="flex flex-col gap-1">
			<span class="text-xs text-muted-foreground">장치</span>
			<Select.Root
				type="single"
				value={deviceId ?? ''}
				onValueChange={(value) => (deviceId = value === '' ? null : value)}
				disabled={data.devices.length === 0}
			>
				<Select.Trigger class="w-full" aria-label="장치">
					{#if selectedDevice}
						<span class="truncate">{selectedDevice.data.displayName || selectedDevice.name}</span>
					{:else}
						<span class="text-muted-foreground">
							{data.devices.length === 0 ? '테마에 장치 애셋이 없습니다' : '선택'}
						</span>
					{/if}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each data.devices as device (device.id)}
							<Select.Item value={device.id} label={device.data.displayName || device.name}>
								{device.data.displayName || device.name}
							</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex flex-col gap-1">
			<span class="text-xs text-muted-foreground">웹사이트 URL</span>
			<Input placeholder="localhost:5173" bind:value={url} aria-label="웹사이트 URL" />
			{#if data.websites.length > 0}
				<Select.Root type="single" value="" onValueChange={(value) => (url = websiteUrl(value))}>
					<Select.Trigger size="sm" class="w-full" aria-label="웹사이트 애셋에서 선택">
						<span class="text-muted-foreground">웹사이트 애셋에서 가져오기…</span>
					</Select.Trigger>
					<Select.Content>
						<Select.Group>
							{#each data.websites as website (website.id)}
								<Select.Item value={website.id} label={website.name}>{website.name}</Select.Item>
							{/each}
						</Select.Group>
					</Select.Content>
				</Select.Root>
			{/if}
			<p class="text-xs text-muted-foreground">
				개발 중인 사이트(vite 등)를 지정하면 HMR이 그대로 동작합니다.
			</p>
		</div>
	</Card.Content>
	<Card.Footer class="flex-col items-stretch gap-2">
		<Button disabled={busy || validationError !== null} onclick={handleStart}>
			{#if busy}
				<Spinner data-icon="inline-start" />
			{/if}
			테스트 시작
		</Button>
		{#if validationError}
			<p class="text-center text-xs text-muted-foreground">{validationError}</p>
		{/if}
	</Card.Footer>
</Card.Root>
