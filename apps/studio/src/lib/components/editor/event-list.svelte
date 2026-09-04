<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { toast } from 'svelte-sonner';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { deleteAsset } from '$lib/api/assets';
	import { useEditorData, type EventAsset } from './editor-data.svelte';
	import EventCard from './event-card.svelte';
	import { toastApiError } from '$lib/api/client';

	let {
		phaseId,
		selectedEventId = $bindable(),
		oncreate,
		onedit
	}: {
		/** Null = common workspace. */
		phaseId: string | null;
		selectedEventId: string | null;
		oncreate: () => void;
		onedit: (event: EventAsset) => void;
	} = $props();

	const editorData = useEditorData();

	let deleteTarget = $state<EventAsset | null>(null);
	let deleting = $state(false);

	const events = $derived(editorData.eventsFor(phaseId));
	/** Other events whose sequence calls the event being deleted. */
	const callers = $derived(
		deleteTarget
			? editorData.events.filter(
					(event) =>
						event.id !== deleteTarget!.id &&
						event.data.sequence.some(
							(entry) => entry.type === 'callEvent' && entry.eventId === deleteTarget!.id
						)
				)
			: []
	);

	async function handleDelete(): Promise<void> {
		if (!deleteTarget || deleting) return;
		deleting = true;
		try {
			await deleteAsset(editorData.themeId, deleteTarget.id);
			if (selectedEventId === deleteTarget.id) selectedEventId = null;
			deleteTarget = null;
			toast.success('이벤트를 삭제했습니다.');
			await editorData.refresh();
		} catch (error) {
			toastApiError(error, '이벤트 삭제에 실패했습니다.');
		} finally {
			deleting = false;
		}
	}
</script>

<div class="flex flex-col gap-2">
	<Button variant="outline" size="sm" onclick={oncreate}>
		<PlusIcon data-icon="inline-start" />
		새 이벤트
	</Button>
	{#if events.length === 0}
		<div class="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
			<ZapIcon class="size-6" />
			<p class="text-sm">
				{phaseId ? '이 페이즈에 이벤트가 없습니다.' : '공통 이벤트가 없습니다.'}
			</p>
		</div>
	{/if}
	{#each events as event (event.id)}
		<EventCard
			{event}
			selected={event.id === selectedEventId}
			onselect={() => {
				selectedEventId = event.id;
				// Every click re-fetches so the sequence shown is never stale.
				void editorData.refresh();
			}}
			onedit={() => onedit(event)}
			ondelete={() => (deleteTarget = event)}
		/>
	{/each}
</div>

<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(open) => {
		if (!open) deleteTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>이벤트를 삭제할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				"{deleteTarget?.name}" 이벤트가 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
				{#if callers.length > 0}
					<span class="mt-2 block text-amber-600 dark:text-amber-500">
						{callers.map((event) => `"${event.name}"`).join(', ')} 이벤트가 이 이벤트를 호출하고 있습니다.
						삭제하면 해당 커맨드는 실행 시 건너뜁니다.
					</span>
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>취소</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" disabled={deleting} onclick={handleDelete}>
				삭제
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
