<script lang="ts">
	import ZapIcon from '@lucide/svelte/icons/zap';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { triggerEvent } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import { toastApiError } from '$lib/api/client';

	let { session, disabled }: { session: SessionView; disabled: boolean } = $props();

	const data = useOperationData();

	const manualEvents = $derived(data.events.filter((e) => e.data.manualTriggerable));
	const currentPhaseEvents = $derived(
		manualEvents.filter((e) => e.data.phaseId !== null && e.data.phaseId === session.phaseId)
	);
	const commonEvents = $derived(manualEvents.filter((e) => e.data.phaseId === null));
	const otherPhaseEvents = $derived(
		manualEvents.filter((e) => e.data.phaseId !== null && e.data.phaseId !== session.phaseId)
	);

	let busyId = $state<string | null>(null);

	async function trigger(eventId: string): Promise<void> {
		if (busyId) return;
		busyId = eventId;
		try {
			await triggerEvent(session.id, eventId);
		} catch (err) {
			toastApiError(err, '이벤트 실행에 실패했습니다.');
		} finally {
			busyId = null;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<ZapIcon class="size-4" />
			수동 이벤트
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if manualEvents.length === 0}
			<p class="text-sm text-muted-foreground">수동 실행 가능한 이벤트가 없습니다.</p>
		{:else}
			{#if currentPhaseEvents.length > 0}
				<div class="flex flex-col gap-1.5">
					<p class="text-xs font-medium text-muted-foreground">현재 페이즈</p>
					<div class="flex flex-wrap gap-1.5">
						{#each currentPhaseEvents as event (event.id)}
							<Button
								size="sm"
								variant="outline"
								disabled={disabled || busyId !== null}
								onclick={() => trigger(event.id)}
							>
								{event.name}
							</Button>
						{/each}
					</div>
				</div>
			{/if}
			{#if commonEvents.length > 0}
				<div class="flex flex-col gap-1.5">
					<p class="text-xs font-medium text-muted-foreground">공통</p>
					<div class="flex flex-wrap gap-1.5">
						{#each commonEvents as event (event.id)}
							<Button
								size="sm"
								variant="outline"
								disabled={disabled || busyId !== null}
								onclick={() => trigger(event.id)}
							>
								{event.name}
							</Button>
						{/each}
					</div>
				</div>
			{/if}
			{#if otherPhaseEvents.length > 0}
				<div class="flex flex-col gap-1.5">
					<p class="text-xs font-medium text-muted-foreground">다른 페이즈</p>
					<div class="flex flex-wrap gap-1.5">
						{#each otherPhaseEvents as event (event.id)}
							<Tooltip.Provider>
								<Tooltip.Root>
									<Tooltip.Trigger>
										{#snippet child({ props })}
											<span {...props}>
												<Button size="sm" variant="outline" disabled>
													{event.name}
												</Button>
											</span>
										{/snippet}
									</Tooltip.Trigger>
									<Tooltip.Content>현재 페이즈가 아닙니다.</Tooltip.Content>
								</Tooltip.Root>
							</Tooltip.Provider>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
