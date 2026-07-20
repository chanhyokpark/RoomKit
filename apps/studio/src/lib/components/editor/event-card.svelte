<script lang="ts">
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import type { TriggerKind } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import AssetActionsMenu from '$lib/components/assets/asset-actions-menu.svelte';
	import { sequenceHasIssues } from './commands/registry';
	import { useEditorData, type EventAsset } from './editor-data.svelte';

	let {
		event,
		selected,
		onselect,
		onedit,
		ondelete
	}: {
		event: EventAsset;
		selected: boolean;
		onselect: () => void;
		onedit: () => void;
		ondelete: () => void;
	} = $props();

	const editorData = useEditorData();

	const TRIGGER_LABELS: Record<TriggerKind, string> = {
		device: '장치',
		manual: '수동',
		system: '시스템'
	};

	const triggerSummary = $derived(
		event.data.triggerName
			? `${TRIGGER_LABELS[event.data.triggerKind]} · ${event.data.triggerName}`
			: TRIGGER_LABELS[event.data.triggerKind]
	);
	const hasIssues = $derived(sequenceHasIssues(event.data.sequence, editorData.byId));
</script>

<div
	class="relative rounded-lg border bg-card p-3 transition-colors {selected
		? 'border-primary ring-1 ring-primary'
		: 'hover:bg-accent/50'}"
>
	<button type="button" class="absolute inset-0 rounded-lg" onclick={onselect}>
		<span class="sr-only">{event.name} 선택</span>
	</button>
	<div class="flex items-start justify-between gap-1">
		<div class="pointer-events-none min-w-0">
			<p class="flex items-center gap-1.5 truncate text-sm font-medium">
				{event.name}
				{#if hasIssues}
					<TriangleAlertIcon
						class="size-3.5 shrink-0 text-amber-500"
						aria-label="미완성이거나 삭제된 애셋을 참조하는 커맨드가 있습니다"
					/>
				{/if}
			</p>
			<p class="mt-0.5 truncate font-mono text-xs text-muted-foreground">{triggerSummary}</p>
		</div>
		<div class="relative shrink-0">
			<AssetActionsMenu {onedit} {ondelete} />
		</div>
	</div>
	<div class="pointer-events-none mt-2 flex flex-wrap items-center gap-1">
		<Badge variant="secondary">커맨드 {event.data.sequence.length}</Badge>
		{#if event.data.manualTriggerable}
			<Badge variant="outline">수동 실행</Badge>
		{/if}
		{#if event.data.allowReentry}
			<Badge variant="outline">재진입</Badge>
		{/if}
	</div>
</div>
