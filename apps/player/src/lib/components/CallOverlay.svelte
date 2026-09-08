<script lang="ts">
	import { call } from '../stores/call.svelte';

	// Covers the website iframe (never unloads it) for the whole request/call.
	// Deliberately spartan: no end button — only the operator ends a call.
	const label = $derived(
		call.state === 'requesting'
			? '통화 요청 중…'
			: call.state === 'connecting'
				? '통화 연결 중…'
				: '통화 중'
	);
</script>

{#if call.state !== 'idle'}
	<div
		class="absolute inset-0 z-45 flex flex-col items-center justify-center gap-10 bg-black text-white select-none"
		role="status"
		aria-live="polite"
	>
		<div class="flex flex-col items-center gap-4">
			<span
				class="size-5 rounded-full {call.state === 'connected'
					? 'bg-green-500'
					: 'animate-pulse bg-neutral-400'}"
			></span>
			<p class="text-3xl font-medium tracking-wide">{label}</p>
		</div>
		{#if call.state === 'requesting'}
			<button
				type="button"
				class="rounded-full border border-neutral-500 px-10 py-4 text-xl text-neutral-200 active:bg-neutral-800 disabled:opacity-40"
				disabled={call.cancelling}
				onclick={() => call.cancel()}
			>
				취소
			</button>
		{/if}
	</div>
{/if}
