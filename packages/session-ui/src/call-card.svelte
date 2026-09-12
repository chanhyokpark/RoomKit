<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import PhoneIncomingIcon from '@lucide/svelte/icons/phone-incoming';
	import PhoneOffIcon from '@lucide/svelte/icons/phone-off';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model, actions } = useSessionUi();
	const call = $derived(model.call ?? null);
	// Calls only reach hint devices (the hintphone site runs the helper); test
	// sessions and hosts without call support show no call controls at all.
	const callsEnabled = $derived(
		!!actions.startCall && model.session?.mode === 'production' && model.session.state !== 'ended'
	);
	const hintDevices = $derived(
		assetsOf(model.assets, 'device').filter((device) => device.data.isHintDevice)
	);
	// Any other device running the helper can take a call too (a kiosk screen
	// with a speaker, say) — offered behind a dropdown so the hint phones stay
	// one click away.
	const otherDevices = $derived(
		assetsOf(model.assets, 'device').filter((device) => !device.data.isHintDevice)
	);
	let otherDeviceId = $state('');
	const otherDevice = $derived(
		otherDevices.find((device) => device.id === otherDeviceId) ?? null
	);

	function deviceLabel(device: { name: string; data: { displayName: string } }): string {
		return device.data.displayName || device.name;
	}

	/** Why a device cannot be called right now; null = callable. */
	function callBlocker(deviceId: string): string | null {
		const status = model.statusOf(deviceId);
		if (!status?.online) return '오프라인';
		if (status.helperVersion === undefined) return 'Helper 미사용';
		return null;
	}

	function start(deviceId: string): void {
		if (!actions.startCall) return;
		void run(() => actions.startCall!(deviceId));
	}
	const ownsCall = $derived(model.ownsCall ?? false);
	let busy = $state(false);
	let now = $state(Date.now());
	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(tick));

	// Incoming-request dialog: only a request that arrives over the socket
	// while this dashboard is open pops it — selecting a session that already
	// has a pending request shows the banner only.
	let dialogOpen = $state(false);
	let seenRequestId = untrack(() => (call?.status === 'requested' ? call.callId : null));
	$effect(() => {
		if (call?.status === 'requested' && call.callId !== seenRequestId) {
			seenRequestId = call.callId;
			dialogOpen = true;
		}
		if (call?.status !== 'requested') dialogOpen = false;
	});

	const statusLabel = $derived(
		call?.status === 'requested'
			? '통화 요청'
			: call?.status === 'connecting'
				? '연결 중'
				: '통화 중'
	);

	const elapsed = $derived.by(() => {
		if (!call?.connectedAt) return null;
		const total = Math.max(0, Math.floor((now - call.connectedAt) / 1000));
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	});

	async function run(action: () => Promise<void>): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '요청이 실패했습니다.');
		} finally {
			busy = false;
		}
	}

	function accept(): void {
		const current = call;
		if (!current || !actions.acceptCall) return;
		dialogOpen = false;
		void run(() => actions.acceptCall!(current.callId));
	}

	function decline(): void {
		const current = call;
		if (!current || !actions.declineCall) return;
		dialogOpen = false;
		void run(() => actions.declineCall!(current.callId));
	}

	function end(): void {
		if (!actions.endCall) return;
		void run(() => actions.endCall!());
	}
</script>

{#if !call && callsEnabled && (hintDevices.length > 0 || otherDevices.length > 0)}
	<div class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
		<PhoneIcon class="size-4 text-muted-foreground" />
		<span class="text-muted-foreground">음성 통화</span>
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if busy}<Spinner />{/if}
			{#each hintDevices as device (device.id)}
				{@const blocker = callBlocker(device.id)}
				<Button
					size="sm"
					variant="outline"
					disabled={busy || blocker !== null}
					title={blocker ?? `${deviceLabel(device)}에 통화 걸기`}
					onclick={() => start(device.id)}
				>
					<PhoneIcon data-icon="inline-start" />
					{deviceLabel(device)}
					{#if blocker}<span class="text-muted-foreground">· {blocker}</span>{/if}
				</Button>
			{/each}
			{#if otherDevices.length > 0}
				{@const otherBlocker = otherDevice ? callBlocker(otherDevice.id) : null}
				<div class="flex items-center gap-1">
					<Select.Root type="single" bind:value={otherDeviceId}>
						<Select.Trigger size="sm" class="min-w-36" aria-label="통화할 다른 장치">
							<span class="truncate">
								{otherDevice ? deviceLabel(otherDevice) : '다른 장치…'}
							</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each otherDevices as device (device.id)}
									{@const blocker = callBlocker(device.id)}
									<Select.Item value={device.id} label={deviceLabel(device)}>
										{deviceLabel(device)}{blocker ? ` · ${blocker}` : ''}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Button
						size="sm"
						variant="outline"
						disabled={busy || !otherDevice || otherBlocker !== null}
						title={otherBlocker ?? (otherDevice ? `${deviceLabel(otherDevice)}에 통화 걸기` : '장치 선택')}
						onclick={() => otherDevice && start(otherDevice.id)}
					>
						<PhoneIcon data-icon="inline-start" />통화
					</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if call}
	<div
		class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm {call.status ===
		'requested'
			? 'border-amber-500/60 bg-amber-500/10'
			: 'border-green-600/60 bg-green-600/10'}"
	>
		{#if call.status === 'requested'}
			<PhoneIncomingIcon class="size-4 animate-pulse" />
		{:else}
			<PhoneIcon class="size-4" />
		{/if}
		<Badge variant={call.status === 'requested' ? 'secondary' : 'default'}>{statusLabel}</Badge>
		<span class="font-medium">{call.deviceName}</span>
		{#if elapsed}<span class="font-mono text-muted-foreground">{elapsed}</span>{/if}
		<div class="ml-auto flex items-center gap-2">
			{#if busy}<Spinner />{/if}
			{#if call.status === 'requested'}
				<Button size="sm" disabled={busy || !actions.acceptCall} onclick={accept}>
					<PhoneIcon data-icon="inline-start" />수락
				</Button>
				<Button
					size="sm"
					variant="outline"
					disabled={busy || !actions.declineCall}
					onclick={decline}
				>
					<PhoneOffIcon data-icon="inline-start" />거절
				</Button>
			{:else if ownsCall}
				<Button size="sm" variant="destructive" disabled={busy || !actions.endCall} onclick={end}>
					<PhoneOffIcon data-icon="inline-start" />종료
				</Button>
			{:else}
				<Badge variant="outline">다른 운영자가 통화 중</Badge>
			{/if}
		</div>
	</div>

	<AlertDialog.Root bind:open={dialogOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Media><PhoneIncomingIcon /></AlertDialog.Media>
				<AlertDialog.Title class="flex flex-wrap items-center gap-2">
					<Badge>통화 요청</Badge>
					<span>{call.deviceName}에서 통화를 요청했습니다.</span>
				</AlertDialog.Title>
				<AlertDialog.Description>
					수락하면 이 브라우저의 마이크로 통화가 시작됩니다. 거절하면 장치의 요청 화면이 닫힙니다.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel onclick={decline}>거절</AlertDialog.Cancel>
				<AlertDialog.Action onclick={accept}>수락</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}
