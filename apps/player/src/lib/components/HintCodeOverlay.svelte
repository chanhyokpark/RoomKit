<script lang="ts">
	import { stage } from '../stores/stage.svelte';

	// The device's hintCodeCss is creator-authored, trusted content (SPEC
	// security note) — injected raw, unscoped by design so themes can restyle
	// .rk-hint-code freely.
	const styleTag = $derived(stage.hintCode ? `<style>${stage.hintCode.css}</style>` : '');
</script>

{#if stage.hintCode && !stage.helperRenders.hintCode}
	{@html styleTag}
	<div class="rk-hint-code">{stage.hintCode.code}</div>
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
