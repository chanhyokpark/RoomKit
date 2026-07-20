<script lang="ts">
	import Settings2Icon from '@lucide/svelte/icons/settings-2';
	import { Button } from '$lib/components/ui/button';
	import * as Tabs from '$lib/components/ui/tabs';
	import { useEditorData } from './editor-data.svelte';

	let {
		workspace,
		onselect,
		onmanage
	}: {
		/** 'common' or a phase asset id. */
		workspace: string;
		onselect: (workspace: string) => void;
		onmanage: () => void;
	} = $props();

	const editorData = useEditorData();
</script>

<div class="flex items-center gap-2">
	<Tabs.Root value={workspace} onValueChange={onselect} class="min-w-0 flex-1">
		<div class="overflow-x-auto">
			<Tabs.List>
				<Tabs.Trigger value="common">공통</Tabs.Trigger>
				{#each editorData.phases as phase (phase.id)}
					<Tabs.Trigger value={phase.id}>{phase.name}</Tabs.Trigger>
				{/each}
			</Tabs.List>
		</div>
	</Tabs.Root>
	<Button variant="outline" size="sm" class="shrink-0" onclick={onmanage}>
		<Settings2Icon data-icon="inline-start" />
		페이즈 관리
	</Button>
</div>
