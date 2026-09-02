<!--
  Constructs the RoomKit helper (player postMessage bridge) and shares it via
  context with getRoomKit() and the components. Mount once, at the top of the
  app (the root +layout.svelte in SvelteKit) — navigation destroys render
  claims, and nested setups would post duplicate hellos.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { RoomKitCore, type RoomKitOptions } from './core.js';
	import { createRoomKitContext } from './context.svelte.js';

	let {
		options = {},
		children
	}: {
		/** Helper options (renders/messages/testCallbacks/lockdown/timerPollMs), read once on mount. */
		options?: RoomKitOptions;
		children?: Snippet;
	} = $props();

	const ctx = createRoomKitContext();

	$effect(() => {
		// Options are read once per mount by design; reconstructing on every
		// change would re-run the player handshake mid-session. The relay keeps
		// getRoomKit() callback registrations across core re-creations.
		const core = new RoomKitCore(options, ctx.relay);
		const unsubscribe = core.subscribe(() => (ctx.snapshot = core.snapshot));
		ctx.core = core;
		ctx.snapshot = core.snapshot;
		return () => {
			unsubscribe();
			core.destroy();
			ctx.core = null;
		};
	});
</script>

{@render children?.()}
