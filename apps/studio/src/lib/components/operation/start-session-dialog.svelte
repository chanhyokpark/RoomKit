<script lang="ts">
	import { untrack } from 'svelte';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { toastApiError } from '$lib/api/client';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import { Spinner } from '$lib/components/ui/spinner';
	import { Switch } from '$lib/components/ui/switch';
	import { resetDevices, startSession } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';

	let { open = $bindable(false), session }: { open?: boolean; session: SessionView } = $props();

	const data = useOperationData();

	let resetFirst = $state(true);
	let busy = $state(false);

	// bits-ui only fires onOpenChange for internally-triggered changes, and this
	// dialog is opened by external state assignment — reset the switch on open.
	$effect(() => {
		if (!open) return;
		untrack(() => (resetFirst = true));
	});

	const offlineDevices = $derived(
		data.devices.filter((device) => !data.isDeviceOnline(session.id, device.id))
	);

	async function handleStart(): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			if (resetFirst) await resetDevices(session.id);
			await startSession(session.id);
			await data.refreshSessions();
			open = false;
			toast.success('세션을 시작했습니다.');
		} catch (err) {
			toastApiError(err, '세션 시작에 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>세션을 시작할까요?</Dialog.Title>
			<Dialog.Description>타이머가 시작되고 세션 시작 이벤트가 실행됩니다.</Dialog.Description>
		</Dialog.Header>
		{#if offlineDevices.length > 0}
			<div
				class="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
			>
				<TriangleAlertIcon class="mt-0.5 size-4 shrink-0" />
				<div>
					<p class="font-medium">오프라인 장치가 있습니다:</p>
					<p>
						{offlineDevices.map((device) => device.data.displayName || device.name).join(', ')}
					</p>
				</div>
			</div>
		{/if}
		<Field.Field orientation="horizontal">
			<Field.FieldContent>
				<Field.FieldLabel for="start-reset">시작 전 모든 디바이스 초기화</Field.FieldLabel>
				<Field.FieldDescription>모든 장치에 reset 명령을 보냅니다.</Field.FieldDescription>
			</Field.FieldContent>
			<Switch id="start-reset" bind:checked={resetFirst} disabled={busy} />
		</Field.Field>
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={() => (open = false)}>취소</Button>
			<Button disabled={busy} onclick={handleStart}>
				{#if busy}<Spinner />{/if}
				{offlineDevices.length > 0 ? '그래도 시작' : '시작'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
