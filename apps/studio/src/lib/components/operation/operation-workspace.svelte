<script lang="ts">
	import { onDestroy } from 'svelte';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import MonitorPlayIcon from '@lucide/svelte/icons/monitor-play';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { Button } from '$lib/components/ui/button';
	import * as Empty from '$lib/components/ui/empty';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte';
	import VersionWarningBanner from '$lib/components/version-warning-banner.svelte';
	import { provideOperationData } from './operation-data.svelte';
	import SessionDashboard from './session-dashboard.svelte';
	import SessionList from './session-list.svelte';

	let { themeId }: { themeId: string } = $props();

	// The route keys this component by themeId, so init-once is safe.
	// svelte-ignore state_referenced_locally
	const data = provideOperationData(themeId);

	const isMobile = new IsMobile();

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
	<div class="flex min-h-0 flex-1">
		<!-- Mobile is master-detail: the list and the dashboard swap in the same space. -->
		{#if !isMobile.current || !data.selected}
			<div
				class="flex shrink-0 flex-col overflow-y-auto p-3 {isMobile.current
					? 'w-full'
					: 'w-72 border-r'}"
			>
				{#if data.loading}
					<div class="flex flex-col gap-2">
						<Skeleton class="h-9 w-full" />
						<Skeleton class="h-9 w-full" />
						<Skeleton class="h-16 w-full" />
					</div>
				{:else}
					<SessionList />
				{/if}
			</div>
		{/if}
		{#if !isMobile.current || data.selected}
			<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
				{#if data.selected}
					{#if isMobile.current}
						<div class="flex shrink-0 items-center border-b px-2 py-1">
							<Button variant="ghost" size="sm" onclick={() => data.select(null)}>
								<ChevronLeftIcon data-icon="inline-start" />
								세션 목록
							</Button>
						</div>
					{/if}
					{#key data.selected.id}
						<SessionDashboard session={data.selected} />
					{/key}
				{:else if !data.loading}
					<div class="flex flex-1 items-center justify-center p-8">
						<Empty.Root>
							<Empty.Header>
								<Empty.Media variant="icon">
									<MonitorPlayIcon />
								</Empty.Media>
								<Empty.Title>세션을 선택하세요</Empty.Title>
								<Empty.Description>
									왼쪽에서 세션을 선택하거나 새 세션을 시작하세요.
								</Empty.Description>
							</Empty.Header>
						</Empty.Root>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</div>
