<script lang="ts">
	import type { JsonValue } from '@roomkit/shared';
	import { stage } from '../stores/stage.svelte';
	import ComponentHost from './ComponentHost.svelte';

	// The player's subtitleCss and the line HTML are creator-authored, trusted
	// content (SPEC security note) — injected raw, unscoped by design so themes
	// can restyle .rk-subtitle freely.
	const styleTag = $derived(stage.subtitle ? `<style>${stage.subtitle.css}</style>` : '');

	let host = $state<{ post: (event: string, payload: JsonValue) => void } | null>(null);

	// Repost per line; the iframe stays mounted for the whole dialogue.
	$effect(() => {
		const subtitle = stage.subtitle;
		if (!subtitle?.component) return;
		host?.post('subtitle', {
			html: subtitle.html,
			lineIndex: subtitle.lineIndex,
			lineCount: subtitle.lineCount
		});
	});
</script>

{#if stage.subtitle}
	{#if stage.subtitle.component}
		{#key stage.subtitle.component.componentId}
			<ComponentHost bind:this={host} component={stage.subtitle.component} class="z-20" />
		{/key}
	{:else}
		{@html styleTag}
		<div class="rk-subtitle">
			{@html stage.subtitle.html}
		</div>
	{/if}
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
