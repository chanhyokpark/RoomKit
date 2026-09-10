<script lang="ts">
	import type { SessionUiActions, SessionUiModel } from './types.js';
	import { provideSessionUi } from './context.js';
	import CallCard from './call-card.svelte';
	import DevicesCard from './devices-card.svelte';
	import EventsCard from './events-card.svelte';
	import LogCard from './log-card.svelte';
	import NotificationsCard from './notifications-card.svelte';
	import PlayersCard from './players-card.svelte';
	import ScreensCard from './screens-card.svelte';
	import SessionControls from './session-controls.svelte';
	import SummaryCard from './summary-card.svelte';
	import TimerPhaseCard from './timer-phase-card.svelte';
	import ToolsCard from './tools-card.svelte';

	let {
		model,
		actions,
		singleColumn = false
	}: {
		model: SessionUiModel;
		actions: SessionUiActions;
		/**
		 * Force the card grid into one column regardless of the viewport breakpoint.
		 * Hosts whose chrome (sidebars, list panes) eats horizontal space use this
		 * when two columns would leave each card too narrow.
		 */
		singleColumn?: boolean;
	} = $props();

	/**
	 * Simple mode is on by default for production sessions and remembered in
	 * localStorage; test sessions always start in full mode and never persist.
	 */
	const SIMPLE_MODE_KEY = 'roomkit:session-ui:simple-mode';

	function storedSimple(): boolean | null {
		try {
			const raw = localStorage.getItem(SIMPLE_MODE_KEY);
			return raw === null ? null : raw === 'true';
		} catch {
			return null;
		}
	}

	function storeSimple(value: boolean): void {
		try {
			localStorage.setItem(SIMPLE_MODE_KEY, String(value));
		} catch {
			// Storage unavailable (private mode, sandboxed webview): keep it in memory.
		}
	}

	/** Explicit toggle by the operator during this dashboard instance. */
	let override = $state<boolean | null>(null);
	const production = $derived(model.session?.mode === 'production');
	const simple = $derived(override ?? (production ? (storedSimple() ?? true) : false));

	// The host adapters are intentionally stable for this keyed dashboard instance.
	// svelte-ignore state_referenced_locally
	provideSessionUi(model, actions, {
		get simple() {
			return simple;
		},
		setSimple(value) {
			override = value;
			if (production) storeSimple(value);
		}
	});
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 p-4">
	<SessionControls />
	<CallCard />
	<NotificationsCard />
	<!-- Desktop rows — simple: timer | events, screens, devices | hint.
	     full: timer | phases, events, screens, devices | players, hint, log. -->
	<div class="grid grid-cols-1 gap-4 {singleColumn ? '' : 'md:grid-cols-2'}">
		{#if model.session?.state === 'ended'}<SummaryCard />{/if}
		<TimerPhaseCard />
		<EventsCard />
		<ScreensCard />
		<DevicesCard />
		<PlayersCard />
		<ToolsCard />
		{#if !simple}<LogCard />{/if}
	</div>
</div>
