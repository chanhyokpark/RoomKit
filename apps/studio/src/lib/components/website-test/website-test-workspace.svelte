<script lang="ts">
	import { onDestroy } from 'svelte';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import VersionWarningBanner from '$lib/components/version-warning-banner.svelte';
	import { provideEditorData } from '$lib/components/editor/editor-data.svelte';
	import { provideWebsiteTestData } from './website-test-data.svelte';
	import ActivityLogCard from './activity-log-card.svelte';
	import EventRunCard from './event-run-card.svelte';
	import ManualCommandCard from './manual-command-card.svelte';
	import RunHeader from './run-header.svelte';
	import SetupPanel from './setup-panel.svelte';
	import TimerCard from './timer-card.svelte';

	let { themeId }: { themeId: string } = $props();

	// The route keys this component by themeId, so init-once is safe.
	// svelte-ignore state_referenced_locally
	const data = provideWebsiteTestData(themeId);
	// The editor's command UI (palette / params / asset selects) reads this
	// context, which is what makes it reusable in the manual command console.
	// svelte-ignore state_referenced_locally
	provideEditorData(themeId);

	onDestroy(() => data.dispose());
</script>

<div class="flex min-h-0 flex-1 flex-col">
	{#if !data.connected && !data.loading}
		<div
			class="flex shrink-0 items-center gap-2 border-b bg-amber-100 px-4 py-1.5 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200"
		>
			<TriangleAlertIcon class="size-4" />
			서버 연결이 끊어졌습니다 — 재연결 중…
		</div>
	{/if}
	<VersionWarningBanner warnings={data.versionWarnings} />
	<div class="min-h-0 flex-1 overflow-y-auto p-4">
		{#if data.loading}
			<div class="mx-auto flex max-w-lg flex-col gap-2">
				<Skeleton class="h-9 w-full" />
				<Skeleton class="h-9 w-full" />
				<Skeleton class="h-32 w-full" />
			</div>
		{:else if data.run === null}
			<SetupPanel />
		{:else}
			<div class="flex flex-col gap-4">
				<RunHeader />
				<div class="grid gap-4 lg:grid-cols-2">
					<div class="flex min-w-0 flex-col gap-4">
						<ManualCommandCard />
						<EventRunCard />
					</div>
					<div class="flex min-w-0 flex-col gap-4">
						<TimerCard />
						<ActivityLogCard />
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
