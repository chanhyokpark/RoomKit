<script lang="ts">
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { cn } from '$lib/utils';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model } = useSessionUi();
	/** Device whose screenshot is shown enlarged; the image keeps updating live. */
	let enlargedDeviceId = $state<string | null>(null);
	let now = $state(Date.now());

	// Players report every few seconds; the staleness check ticks alongside.
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	/** A capture older than this is likely from a stalled or paused player. */
	const STALE_AFTER_MS = 20_000;

	const allDevices = $derived(assetsOf(model.assets, 'device'));
	const codeDeviceIds = $derived(new Set(model.testDeviceCodes.map((entry) => entry.deviceId)));
	// Test sessions only open the devices that got a code; mirror the devices card.
	const devices = $derived(
		codeDeviceIds.size > 0
			? allDevices.filter((device) => codeDeviceIds.has(device.id))
			: allDevices
	);
	const screens = $derived(
		devices.flatMap((device) => {
			const screenshot = model.screenshotOf(device.id);
			return screenshot ? [{ device, screenshot }] : [];
		})
	);
	const enlarged = $derived(enlargedDeviceId ? model.screenshotOf(enlargedDeviceId) : null);

	function ago(capturedAt: number): string {
		const seconds = Math.max(0, Math.round((now - capturedAt) / 1000));
		if (seconds < 60) return `${seconds}초 전`;
		return `${Math.floor(seconds / 60)}분 전`;
	}

	function deviceName(deviceId: string): string {
		const device = allDevices.find((candidate) => candidate.id === deviceId);
		return device ? device.data.displayName || device.name : deviceId;
	}
</script>

{#if screens.length > 0}
	<Card.Root class="md:col-span-2">
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><MonitorIcon />화면</Card.Title>
			<Card.Description
				>플레이어 장치 창의 실시간 캡처입니다. 클릭하면 크게 봅니다.</Card.Description
			>
		</Card.Header>
		<Card.Content class="flex flex-wrap gap-3">
			{#each screens as { device, screenshot } (device.id)}
				{@const name = device.data.displayName || device.name}
				{@const stale = now - screenshot.capturedAt > STALE_AFTER_MS}
				{@const online = model.statusOf(device.id)?.online ?? false}
				<figure class="flex max-w-full flex-col gap-1">
					<button
						type="button"
						class="relative block overflow-hidden rounded-md ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
						aria-label="{name} 화면 확대"
						onclick={() => (enlargedDeviceId = device.id)}
					>
						<img
							src={screenshot.image}
							alt="{name} 화면"
							width={screenshot.width}
							height={screenshot.height}
							class={cn('block h-40 w-auto max-w-full', (stale || !online) && 'opacity-50')}
						/>
						{#if stale}
							<span
								class="absolute right-1.5 bottom-1.5 rounded bg-amber-600/80 px-1.5 py-0.5 text-[10px] text-white"
							>
								{ago(screenshot.capturedAt)}
							</span>
						{/if}
					</button>
					<figcaption class="flex items-center gap-1.5 text-xs">
						<span class="truncate">{name}</span>
						{#if device.data.isHintDevice}<Badge variant="secondary">힌트</Badge>{/if}
						{#if !online}<Badge variant="secondary">오프라인</Badge>{/if}
					</figcaption>
				</figure>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}

<Dialog.Root
	open={enlargedDeviceId !== null}
	onOpenChange={(open) => {
		if (!open) enlargedDeviceId = null;
	}}
>
	<Dialog.Content class="sm:max-w-5xl">
		<Dialog.Header>
			<Dialog.Title>{enlargedDeviceId ? deviceName(enlargedDeviceId) : ''} 화면</Dialog.Title>
			<Dialog.Description>
				{#if enlarged}
					{enlarged.width}×{enlarged.height} · {ago(enlarged.capturedAt)} 캡처 · 자동 갱신
				{:else}
					캡처된 화면이 없습니다.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if enlarged}
			<img
				src={enlarged.image}
				alt="{enlargedDeviceId ? deviceName(enlargedDeviceId) : ''} 화면"
				width={enlarged.width}
				height={enlarged.height}
				class="mx-auto block max-h-[75vh] w-auto max-w-full rounded-md"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
