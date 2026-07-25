<script lang="ts">
	import type { JsonValue } from '@roomkit/shared';
	import { stage } from '../stores/stage.svelte';
	import ComponentHost from './ComponentHost.svelte';

	// The device's hintCodeCss is creator-authored, trusted content (SPEC
	// security note) — injected raw, unscoped by design so themes can restyle
	// .rk-hint-code freely.
	const styleTag = $derived(stage.hintCode ? `<style>${stage.hintCode.css}</style>` : '');

	let host = $state<{ post: (event: string, payload: JsonValue) => void } | null>(null);

	// Repost when a newer show replaces the code on the same component.
	$effect(() => {
		const hintCode = stage.hintCode;
		if (!hintCode?.component) return;
		host?.post('hintCode', { code: hintCode.code });
	});
</script>

{#if stage.hintCode}
	{#if stage.hintCode.component}
		{#key stage.hintCode.component.componentId}
			<ComponentHost bind:this={host} component={stage.hintCode.component} class="z-30" />
		{/key}
	{:else}
		{@html styleTag}
		<div class="rk-hint-code">{stage.hintCode.code}</div>
	{/if}
{/if}

<style>
	/* Default look; creator CSS may override any of it. */
	:global(.rk-hint-code) {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 30;
		padding: 0.35em 0.75em;
		border-radius: 0.5em;
		background: rgb(0 0 0 / 0.6);
		font-family: ui-monospace, monospace;
		font-size: clamp(1.5rem, 4vw, 3rem);
		letter-spacing: 0.15em;
		line-height: 1.2;
	}
</style>
