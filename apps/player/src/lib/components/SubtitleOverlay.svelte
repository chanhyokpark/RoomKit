<script lang="ts">
	import { stage } from '../stores/stage.svelte';

	// The player's subtitleCss and the line HTML are creator-authored, trusted
	// content (SPEC security note) — injected raw, unscoped by design so themes
	// can restyle .rk-subtitle freely.
	const styleTag = $derived(stage.subtitle ? `<style>${stage.subtitle.css}</style>` : '');
</script>

{#if stage.subtitle && !stage.helperRenders.subtitle}
	{@html styleTag}
	<div class="rk-subtitle">
		{@html stage.subtitle.html}
	</div>
{/if}

<style>
	/* Default look; creator CSS may override any of it. */
	:global(.rk-subtitle) {
		position: absolute;
		inset-inline: 0;
		bottom: 8vh;
		z-index: 20;
		margin-inline: auto;
		max-width: 80%;
		width: fit-content;
		padding: 0.5em 1em;
		border-radius: 0.5em;
		background: rgb(0 0 0 / 0.6);
		text-align: center;
		font-size: clamp(1.25rem, 3vw, 2.25rem);
		line-height: 1.4;
	}
</style>
