<!-- Rendered by Stage only in test sessions; production shows none of this. -->
<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import { stage } from '../stores/stage.svelte';

	const CHANNEL_LABELS: Record<string, string> = {
		bgm: 'BGM',
		sfx: 'SFX',
		dialogue: 'DIALOGUE',
		video: 'VIDEO'
	};

	// The placeholder card stands in for the video surface, so it follows the
	// same frame placement as the real <video>.
	const videoFrameStyle = $derived(
		stage.videoFrame
			? `left:${stage.videoFrame.x}%;top:${stage.videoFrame.y}%;width:${stage.videoFrame.width}%;height:${stage.videoFrame.height}%`
			: 'inset:0'
	);
</script>

{#if stage.videoPlaceholder !== null}
	<div class="absolute z-10 flex items-center justify-center bg-black" style={videoFrameStyle}>
		<div
			class="flex flex-col items-center gap-2 rounded-xl border border-neutral-700 px-10 py-8 text-neutral-300"
		>
			<span class="text-xs tracking-widest text-neutral-500">VIDEO PLACEHOLDER</span>
			<span class="text-2xl font-semibold">{stage.videoPlaceholder}</span>
		</div>
	</div>
{/if}

{#if stage.placeholders.length > 0}
	<!-- Bottom-left: clear of the test-mode top bar and the skip buttons. -->
	<div class="absolute bottom-3 left-3 z-30 flex flex-col items-start gap-1.5">
		{#each stage.placeholders as chip (chip.id)}
			<span
				class="flex items-center gap-1.5 rounded-full border border-neutral-600 bg-black/70 py-1 pr-1.5 pl-3 text-xs text-neutral-300"
			>
				{CHANNEL_LABELS[chip.channel] ?? chip.channel} · {chip.name}
				<!-- Same effect as the session UI's per-media stop button. -->
				<button
					type="button"
					class="flex size-5 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white"
					title="재생 정지"
					aria-label="재생 정지"
					onclick={() => chip.stop()}
				>
					<XIcon class="size-3.5" />
				</button>
			</span>
		{/each}
	</div>
{/if}
