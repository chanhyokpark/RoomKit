<script lang="ts">
	import WorkflowIcon from '@lucide/svelte/icons/workflow';
	import type { Asset } from '@roomkit/shared';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import * as Empty from '$lib/components/ui/empty';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import type { EditorState } from '$lib/components/assets/types';
	import AssetDialog from './asset-dialog.svelte';
	import { provideEditorData } from './editor-data.svelte';
	import EventList from './event-list.svelte';
	import PhaseManagerDialog from './phase-manager-dialog.svelte';
	import PhaseTabs from './phase-tabs.svelte';
	import SequenceEditor from './sequence-editor.svelte';

	let { themeId }: { themeId: string } = $props();

	// The route keys this component by themeId, so init-once is safe.
	// svelte-ignore state_referenced_locally
	const editorData = provideEditorData(themeId);

	/** 'common' or a phase asset id. */
	let workspace = $state(page.url.searchParams.get('phase') ?? 'common');
	let selectedEventId = $state<string | null>(page.url.searchParams.get('event'));
	let phaseManagerOpen = $state(false);
	let eventDialog = $state<EditorState | null>(null);

	// A deleted phase falls back to the common workspace.
	const effectiveWorkspace = $derived(
		workspace === 'common' || editorData.byId.has(workspace) ? workspace : 'common'
	);
	const workspacePhaseId = $derived(effectiveWorkspace === 'common' ? null : effectiveWorkspace);
	// Selection only shows while the event stays in the current workspace.
	const selectedEvent = $derived(
		editorData.events.find(
			(event) => event.id === selectedEventId && event.data.phaseId === workspacePhaseId
		) ?? null
	);

	// Keep the workspace and selected event shareable via the URL. Waits for the
	// first load so a deep link isn't stripped before assets arrive.
	$effect(() => {
		if (editorData.loading) return;
		const url = new URL(page.url);
		if (workspacePhaseId) url.searchParams.set('phase', workspacePhaseId);
		else url.searchParams.delete('phase');
		if (selectedEvent) url.searchParams.set('event', selectedEvent.id);
		else url.searchParams.delete('event');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same-page query update
		if (url.search !== page.url.search) replaceState(url, page.state);
	});

	function handleEventSaved(saved: Asset): void {
		eventDialog = null;
		if (saved.kind !== 'event') return;
		// Follow the event to its (possibly new) workspace.
		workspace = saved.data.phaseId ?? 'common';
		selectedEventId = saved.id;
		void editorData.refresh();
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="shrink-0 border-b p-3">
		<PhaseTabs
			workspace={effectiveWorkspace}
			onselect={(value) => (workspace = value)}
			onmanage={() => (phaseManagerOpen = true)}
		/>
	</div>
	<div class="flex min-h-0 flex-1">
		<div class="flex w-72 shrink-0 flex-col overflow-y-auto border-r p-3">
			{#if editorData.loading}
				<div class="flex flex-col gap-2">
					<Skeleton class="h-20 w-full" />
					<Skeleton class="h-20 w-full" />
				</div>
			{:else}
				<EventList
					phaseId={workspacePhaseId}
					bind:selectedEventId
					oncreate={() => (eventDialog = { mode: 'create', kind: 'event' })}
					onedit={(event) => (eventDialog = { mode: 'edit', asset: event })}
				/>
			{/if}
		</div>
		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			{#if selectedEvent}
				{#key selectedEvent.id}
					<SequenceEditor
						event={selectedEvent}
						oneditmeta={() => {
							if (selectedEvent) eventDialog = { mode: 'edit', asset: selectedEvent };
						}}
					/>
				{/key}
			{:else}
				<div class="flex flex-1 items-center justify-center p-8">
					<Empty.Root>
						<Empty.Header>
							<Empty.Media variant="icon">
								<WorkflowIcon />
							</Empty.Media>
							<Empty.Title>이벤트를 선택하세요</Empty.Title>
							<Empty.Description>
								왼쪽 목록에서 이벤트를 선택하면 커맨드 시퀀스를 편집할 수 있습니다.
							</Empty.Description>
						</Empty.Header>
					</Empty.Root>
				</div>
			{/if}
		</div>
	</div>
</div>

<PhaseManagerDialog bind:open={phaseManagerOpen} />

<AssetDialog
	{themeId}
	editing={eventDialog}
	tags={editorData.tags}
	defaultPhaseId={workspacePhaseId ?? undefined}
	onsaved={handleEventSaved}
	onclose={() => (eventDialog = null)}
/>
