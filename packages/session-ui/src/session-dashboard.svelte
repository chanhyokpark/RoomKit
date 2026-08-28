<script lang="ts">
	import type { SessionUiActions, SessionUiModel } from './types.js';
	import { provideSessionUi } from './context.js';
	import DevicesCard from './devices-card.svelte';
	import EventsCard from './events-card.svelte';
	import LogCard from './log-card.svelte';
	import NotificationsCard from './notifications-card.svelte';
	import SessionControls from './session-controls.svelte';
	import SummaryCard from './summary-card.svelte';
	import TimerPhaseCard from './timer-phase-card.svelte';
	import ToolsCard from './tools-card.svelte';

	let { model, actions }: { model: SessionUiModel; actions: SessionUiActions } = $props();
	// The host adapters are intentionally stable for this keyed dashboard instance.
	// svelte-ignore state_referenced_locally
	provideSessionUi(model, actions);
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 p-4">
	<SessionControls />
	<NotificationsCard />
	<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
		{#if model.session?.state === 'ended'}<SummaryCard />{/if}
		<TimerPhaseCard />
		<EventsCard />
		<DevicesCard />
		<ToolsCard />
		<LogCard />
	</div>
</div>
