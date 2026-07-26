<script lang="ts">
	import CopyIcon from '@lucide/svelte/icons/copy';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RouterIcon from '@lucide/svelte/icons/router';
	import XIcon from '@lucide/svelte/icons/x';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { Command, PlayChannel, PlayingMedia, TestDeviceCode } from '@roomkit/shared';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { getSession, resetDevices, runSessionCommand } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import { toastApiError } from '$lib/api/client';

	let { session, disabled }: { session: SessionView; disabled: boolean } = $props();

	const data = useOperationData();

	let confirming = $state(false);
	let busy = $state(false);
	let codes = $state<TestDeviceCode[] | null>(null);

	const media = $derived(data.mediaFor(session.id));
	const websiteByDevice = $derived(new Map(media.websites.map((w) => [w.deviceId, w])));
	const playingByDevice = $derived.by(() => {
		// Rebuilt wholesale by $derived and never mutated, so a plain Map is fine.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const map = new Map<string, PlayingMedia[]>();
		for (const entry of media.playing) {
			const list = map.get(entry.deviceId);
			if (list) list.push(entry);
			else map.set(entry.deviceId, [entry]);
		}
		return map;
	});

	const channelLabels: Record<PlayChannel, string> = {
		bgm: 'BGM',
		sfx: '효과음',
		dialogue: '대사',
		video: '비디오'
	};
	const stopTypes: Record<PlayChannel, Command['type']> = {
		bgm: 'stopBgm',
		sfx: 'stopSfx',
		dialogue: 'stopDialogue',
		video: 'stopVideo'
	};

	/** Keys ("commandId" / "web:deviceId") with a stop request in flight. */
	const stopping = new SvelteSet<string>();

	/**
	 * Sends the channel's stop command: the device acks the play wire 'done',
	 * so awaiting sequences continue as if playback ended normally.
	 */
	async function stopMedia(entry: PlayingMedia): Promise<void> {
		if (stopping.has(entry.commandId)) return;
		stopping.add(entry.commandId);
		try {
			await runSessionCommand(session.id, {
				type: stopTypes[entry.channel],
				playerId: entry.playerId,
				allPlayers: false
			} as Command);
		} catch (err) {
			toastApiError(err, '재생을 정지하지 못했습니다.');
		} finally {
			stopping.delete(entry.commandId);
		}
	}

	/** The only way to close a website is to reset the device it runs on. */
	async function stopWebsite(deviceId: string): Promise<void> {
		const key = `web:${deviceId}`;
		if (stopping.has(key)) return;
		stopping.add(key);
		try {
			await runSessionCommand(session.id, { type: 'resetDevice', deviceId });
		} catch (err) {
			toastApiError(err, '웹사이트를 종료하지 못했습니다.');
		} finally {
			stopping.delete(key);
		}
	}

	// The dashboard keys this card by session id, so a setup-time fetch suffices.
	// svelte-ignore state_referenced_locally
	if (session.mode === 'test') {
		getSession(session.id)
			.then((res) => (codes = res.testDeviceCodes ?? []))
			.catch(() => toast.error('테스트 코드를 불러오지 못했습니다.'));
	}

	const codeByDevice = $derived(
		new Map((codes ?? []).map((entry) => [entry.deviceId, entry.code]))
	);

	async function copyCode(code: string): Promise<void> {
		await navigator.clipboard.writeText(code);
		toast.success('코드가 복사되었습니다.');
	}

	async function handleReset(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await resetDevices(session.id);
			toast.success('모든 디바이스에 초기화 명령을 보냈습니다.');
		} catch (err) {
			toastApiError(err, '디바이스 초기화에 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<RouterIcon class="size-4" />
			디바이스
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if data.devices.length === 0}
			<p class="text-sm text-muted-foreground">이 테마에 장치 애셋이 없습니다.</p>
		{:else}
			<ul class="flex flex-col gap-1.5">
				{#each data.devices as device (device.id)}
					{@const online = data.isDeviceOnline(session.id, device.id)}
					{@const code = codeByDevice.get(device.id)}
					{@const website = websiteByDevice.get(device.id)}
					{@const playing = playingByDevice.get(device.id) ?? []}
					<li class="flex flex-col gap-1 text-sm">
						<div class="flex items-center gap-2">
							<span
								class="size-2 shrink-0 rounded-full {online
									? 'bg-emerald-500'
									: 'bg-muted-foreground/40'}"
							></span>
							<span class="truncate">{device.data.displayName || device.name}</span>
							{#if device.data.isHintDevice}
								<Badge variant="secondary">힌트</Badge>
							{/if}
							<span class="ml-auto flex shrink-0 items-center gap-1.5">
								{#if code}
									<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{code}</code>
									<Button
										variant="ghost"
										size="icon"
										class="size-7"
										aria-label="코드 복사"
										onclick={() => copyCode(code)}
									>
										<CopyIcon />
									</Button>
								{/if}
								<span class="text-xs text-muted-foreground">
									{online ? '온라인' : '오프라인'}
								</span>
							</span>
						</div>
						{#if website || playing.length > 0}
							<ul class="ml-4 flex flex-col gap-0.5 border-l pl-2">
								{#if website}
									<li class="flex items-center gap-1.5 text-xs">
										<Badge variant="outline" class="px-1 py-0 text-[10px]">웹사이트</Badge>
										<span class="min-w-0 truncate" title={website.url}>
											{data.assetName(website.websiteId) ?? website.url}
										</span>
										<Button
											variant="ghost"
											size="icon"
											class="ml-auto size-5 shrink-0 text-muted-foreground hover:text-destructive"
											aria-label="웹사이트 종료 (장치 리셋)"
											title="웹사이트 종료 (장치 리셋)"
											disabled={disabled || stopping.has(`web:${device.id}`)}
											onclick={() => stopWebsite(device.id)}
										>
											<XIcon />
										</Button>
									</li>
								{/if}
								{#each playing as entry (entry.commandId)}
									<li class="flex items-center gap-1.5 text-xs">
										<Badge variant="outline" class="px-1 py-0 text-[10px]">
											{channelLabels[entry.channel]}
										</Badge>
										<span class="min-w-0 truncate">
											{data.assetName(entry.assetId) ?? entry.assetName}
										</span>
										<Button
											variant="ghost"
											size="icon"
											class="ml-auto size-5 shrink-0 text-muted-foreground hover:text-destructive"
											aria-label="재생 정지"
											title="재생 정지"
											disabled={disabled || stopping.has(entry.commandId)}
											onclick={() => stopMedia(entry)}
										>
											<XIcon />
										</Button>
									</li>
								{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ul>
			<Button
				size="sm"
				variant="outline"
				disabled={disabled || busy}
				onclick={() => (confirming = true)}
			>
				<RotateCcwIcon data-icon="inline-start" />
				모든 디바이스 초기화
			</Button>
		{/if}
	</Card.Content>
</Card.Root>

<AlertDialog.Root
	open={confirming}
	onOpenChange={(value) => {
		if (!value) confirming = false;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>모든 디바이스를 초기화할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				세션의 모든 장치에 reset 명령을 보냅니다. 장치는 초기 상태로 돌아갑니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>취소</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					confirming = false;
					void handleReset();
				}}
			>
				초기화
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
