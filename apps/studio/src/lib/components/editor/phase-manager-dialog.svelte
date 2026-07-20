<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { CreateAssetInputSchema, type JsonValue } from '@roomkit/shared';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { createAsset, deleteAsset, updateAsset } from '$lib/api/assets';
	import { useEditorData, type PhaseAsset } from './editor-data.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const editorData = useEditorData();

	let newName = $state('');
	let busy = $state(false);
	let deleteTarget = $state<PhaseAsset | null>(null);

	const deleteTargetEventCount = $derived(
		deleteTarget ? editorData.eventsFor(deleteTarget.id).length : 0
	);

	async function run(action: () => Promise<void>, failMessage: string): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
			await editorData.refresh();
		} catch {
			toast.error(failMessage);
		} finally {
			busy = false;
		}
	}

	function commitRename(phase: PhaseAsset, value: string): void {
		const name = value.trim();
		if (!name || name === phase.name) return;
		void run(async () => {
			await updateAsset(editorData.themeId, phase.id, { name });
		}, '페이즈 이름 변경에 실패했습니다.');
	}

	function movePhase(index: number, delta: number): void {
		const target = index + delta;
		const phases = editorData.phases;
		if (target < 0 || target >= phases.length) return;
		const reordered = [...phases];
		[reordered[index], reordered[target]] = [reordered[target], reordered[index]];
		void run(async () => {
			// Renormalize to 0..n-1 and patch only the phases whose order changed.
			await Promise.all(
				reordered.map((phase, order) =>
					phase.data.order === order
						? Promise.resolve()
						: updateAsset(editorData.themeId, phase.id, { data: { order } })
				)
			);
		}, '페이즈 순서 변경에 실패했습니다.');
	}

	function handleCreate(event: SubmitEvent): void {
		event.preventDefault();
		const name = newName.trim();
		if (!name) return;
		void run(async () => {
			const input = CreateAssetInputSchema.parse({
				kind: 'phase',
				name,
				data: { order: editorData.phases.length }
			});
			await createAsset(editorData.themeId, input);
			newName = '';
			toast.success('페이즈를 만들었습니다.');
		}, '페이즈 생성에 실패했습니다.');
	}

	function handleDelete(): void {
		const phase = deleteTarget;
		if (!phase) return;
		void run(async () => {
			// Events of the deleted phase become common events (full-data replacement).
			for (const event of editorData.eventsFor(phase.id)) {
				const data = {
					...($state.snapshot(event.data) as unknown as Record<string, JsonValue>),
					phaseId: null
				};
				await updateAsset(editorData.themeId, event.id, { data });
			}
			await deleteAsset(editorData.themeId, phase.id);
			deleteTarget = null;
			toast.success('페이즈를 삭제했습니다.');
		}, '페이즈 삭제에 실패했습니다.');
	}
</script>

<Dialog.Root
	bind:open
	onOpenChange={(value) => {
		if (value) newName = '';
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>페이즈 관리</Dialog.Title>
			<Dialog.Description>페이즈를 만들고 이름과 순서를 관리합니다.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2">
			{#if editorData.phases.length === 0}
				<p class="py-4 text-center text-sm text-muted-foreground">아직 페이즈가 없습니다.</p>
			{/if}
			{#each editorData.phases as phase, index (phase.id)}
				<div class="flex items-center gap-1">
					<Input
						class="flex-1"
						value={phase.name}
						disabled={busy}
						aria-label="페이즈 이름"
						onblur={(event) => commitRename(phase, event.currentTarget.value)}
						onkeydown={(event) => {
							if (event.key === 'Enter') event.currentTarget.blur();
						}}
					/>
					<Button
						variant="ghost"
						size="icon"
						disabled={busy || index === 0}
						aria-label="위로"
						onclick={() => movePhase(index, -1)}
					>
						<ChevronUpIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						disabled={busy || index === editorData.phases.length - 1}
						aria-label="아래로"
						onclick={() => movePhase(index, 1)}
					>
						<ChevronDownIcon />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						class="text-destructive"
						disabled={busy}
						aria-label="삭제"
						onclick={() => (deleteTarget = phase)}
					>
						<Trash2Icon />
					</Button>
				</div>
			{/each}
		</div>
		<form class="flex items-center gap-2" onsubmit={handleCreate}>
			<Input bind:value={newName} placeholder="새 페이즈 이름" disabled={busy} />
			<Button type="submit" variant="outline" disabled={busy || !newName.trim()}>
				<PlusIcon data-icon="inline-start" />
				추가
			</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={deleteTarget !== null}
	onOpenChange={(value) => {
		if (!value) deleteTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>페이즈를 삭제할까요?</AlertDialog.Title>
			<AlertDialog.Description>
				"{deleteTarget?.name}" 페이즈가 삭제됩니다.
				{#if deleteTargetEventCount > 0}
					이 페이즈의 이벤트 {deleteTargetEventCount}개는 공통으로 이동합니다.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={busy}>취소</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" disabled={busy} onclick={handleDelete}>
				삭제
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
