<script lang="ts">
	import PauseIcon from '@lucide/svelte/icons/pause';
	import PlayIcon from '@lucide/svelte/icons/play';
	import SquareIcon from '@lucide/svelte/icons/square';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import { Spinner } from '$lib/components/ui/spinner';
	import { Switch } from '$lib/components/ui/switch';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model, actions } = useSessionUi();
	let busy = $state(false);
	let startOpen = $state(false);
	let endOpen = $state(false);
	let resetFirst = $state(true);

	const session = $derived(model.session);
	const devices = $derived(assetsOf(model.assets, 'device'));
	const offline = $derived(devices.filter((device) => !model.statusOf(device.id)?.online));
	const stateLabel = $derived(
		session
			? {
					created: '시작 전',
					running: '진행 중',
					paused: '일시정지',
					ended: '종료됨'
				}[session.state]
			: '상태 대기 중'
	);

	async function run(action: () => Promise<void>, success?: string): Promise<boolean> {
		if (busy) return false;
		busy = true;
		try {
			await action();
			if (success) toast.success(success);
			return true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '요청이 실패했습니다.');
			return false;
		} finally {
			busy = false;
		}
	}

	async function start(): Promise<void> {
		if (await run(() => actions.start(resetFirst), '세션을 시작했습니다.')) startOpen = false;
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<Badge variant={session?.mode === 'production' ? 'default' : 'secondary'}>
		{session?.mode === 'production' ? '프로덕션' : '테스트'}
	</Badge>
	<Badge
		variant={session?.state === 'running'
			? 'outline'
			: session?.state === 'ended'
				? 'destructive'
				: 'secondary'}
	>
		{stateLabel}
	</Badge>
	<Badge variant={model.connected ? 'outline' : 'secondary'}>
		{model.connected ? '실시간 연결됨' : '연결 끊김'}
	</Badge>
	{#if session?.verdict}
		<Badge variant={session.verdict === 'success' ? 'default' : 'destructive'}>
			{session.verdict === 'success' ? '성공' : '실패'}
		</Badge>
	{/if}
	<div class="ml-auto flex items-center gap-2">
		{#if busy}<Spinner />{/if}
		{#if session?.state === 'created'}
			<Button size="sm" disabled={busy} onclick={() => (startOpen = true)}>
				<PlayIcon data-icon="inline-start" />
				세션 시작
			</Button>
		{:else if session?.state === 'running'}
			<Button size="sm" variant="outline" disabled={busy} onclick={() => void run(actions.pause)}>
				<PauseIcon data-icon="inline-start" />
				일시정지
			</Button>
		{:else if session?.state === 'paused'}
			<Button size="sm" variant="outline" disabled={busy} onclick={() => void run(actions.resume)}>
				<PlayIcon data-icon="inline-start" />
				재개
			</Button>
		{/if}
		<Button
			size="sm"
			variant="destructive"
			disabled={busy || !session || session.state === 'ended'}
			onclick={() => (endOpen = true)}
		>
			<SquareIcon data-icon="inline-start" />
			세션 종료
		</Button>
	</div>
</div>

<Dialog.Root bind:open={startOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>세션을 시작할까요?</Dialog.Title>
			<Dialog.Description>타이머와 세션 시작 이벤트가 실행됩니다.</Dialog.Description>
		</Dialog.Header>
		{#if offline.length > 0}
			<div class="flex items-start gap-2 rounded-md border bg-muted p-3 text-sm">
				<TriangleAlertIcon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div class="flex flex-col gap-1">
					<p class="font-medium">오프라인 장치가 있습니다.</p>
					<p class="text-muted-foreground">
						{offline.map((device) => device.data.displayName || device.name).join(', ')}
					</p>
				</div>
			</div>
		{/if}
		<Field.Field orientation="horizontal">
			<Field.FieldContent>
				<Field.FieldLabel for="shared-session-start-reset">
					시작 전 모든 디바이스 초기화
				</Field.FieldLabel>
				<Field.FieldDescription>각 장치를 초기 상태로 되돌립니다.</Field.FieldDescription>
			</Field.FieldContent>
			<Switch id="shared-session-start-reset" bind:checked={resetFirst} disabled={busy} />
		</Field.Field>
		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={() => (startOpen = false)}>취소</Button>
			<Button disabled={busy} onclick={start}>
				{#if busy}<Spinner data-icon="inline-start" />{/if}
				{offline.length > 0 ? '그래도 시작' : '시작'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={endOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>세션을 종료할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				실행 중인 시퀀스가 모두 중단됩니다. 종료된 세션은 다시 시작할 수 없습니다.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>취소</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => {
					endOpen = false;
					void run(actions.end);
				}}
			>
				종료
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
