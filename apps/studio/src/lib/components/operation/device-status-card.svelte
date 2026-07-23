<script lang="ts">
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RouterIcon from '@lucide/svelte/icons/router';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { resetDevices } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import { toastApiError } from '$lib/api/client';

	let { session, disabled }: { session: SessionView; disabled: boolean } = $props();

	const data = useOperationData();

	let confirming = $state(false);
	let busy = $state(false);

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
					<li class="flex items-center gap-2 text-sm">
						<span
							class="size-2 shrink-0 rounded-full {online
								? 'bg-emerald-500'
								: 'bg-muted-foreground/40'}"
						></span>
						<span class="truncate">{device.data.displayName || device.name}</span>
						{#if device.data.isHintDevice}
							<Badge variant="secondary">힌트</Badge>
						{/if}
						<span class="ml-auto text-xs text-muted-foreground">
							{online ? '온라인' : '오프라인'}
						</span>
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
