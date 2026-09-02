<!--
  Headless hint-code entry: on-screen keypad (default) or a plain text input.
  Unstyled semantic DOM with class hooks (`.rk-hint-input*`). Submitting sends
  the code through the player bridge; the reply lands in the hint facade
  (rendered by HintRenderer).
-->
<script lang="ts">
	import type { RoomKitHintApi } from './core.js';
	import { getRoomKit } from './roomkit.js';

	let {
		hint,
		variant = 'keypad',
		maxLength = 8,
		onSubmit,
		class: className = 'rk-hint-input',
		labels
	}: {
		/** Hint facade to drive; defaults to the context's `getRoomKit().hint`. */
		hint?: RoomKitHintApi;
		/** 'keypad' (default) renders digit keys; 'text' a plain input. */
		variant?: 'keypad' | 'text';
		/** Max code length (keypad ignores further digits). Default 8. */
		maxLength?: number;
		/** Called instead of the default submit (hint.submit). */
		onSubmit?: (code: string) => void;
		/** Root class hook. Default 'rk-hint-input'. */
		class?: string;
		labels?: { submit?: string; clear?: string; backspace?: string; placeholder?: string };
	} = $props();

	const rk = getRoomKit();
	const h = $derived(hint ?? rk.hint);
	let value = $state('');

	const disabled = $derived(h.pending);

	function submit(code: string) {
		const trimmed = code.trim();
		if (!trimmed) return;
		if (onSubmit) onSubmit(trimmed);
		else h.submit(trimmed);
		value = '';
	}

	function press(digit: string) {
		if (value.length < maxLength) value += digit;
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		submit(value);
	}

	const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
</script>

{#if variant === 'text'}
	<form class={className} data-variant="text" onsubmit={handleSubmit}>
		<input
			class="{className}-field"
			bind:value
			maxlength={maxLength}
			placeholder={labels?.placeholder ?? '힌트 코드'}
			{disabled}
		/>
		<button type="submit" class="{className}-submit" {disabled}>
			{labels?.submit ?? '확인'}
		</button>
	</form>
{:else}
	<div class={className} data-variant="keypad">
		<output class="{className}-display">{value}</output>
		<div class="{className}-keys">
			{#each keys as digit (digit)}
				<button
					type="button"
					class="{className}-key"
					data-key={digit}
					{disabled}
					onclick={() => press(digit)}
				>
					{digit}
				</button>
			{/each}
			<button
				type="button"
				class="{className}-key {className}-key-clear"
				data-key="clear"
				{disabled}
				onclick={() => (value = '')}
			>
				{labels?.clear ?? 'C'}
			</button>
			<button type="button" class="{className}-key" data-key="0" {disabled} onclick={() => press('0')}>
				0
			</button>
			<button
				type="button"
				class="{className}-key {className}-key-back"
				data-key="backspace"
				{disabled}
				onclick={() => (value = value.slice(0, -1))}
			>
				{labels?.backspace ?? '⌫'}
			</button>
		</div>
		<button
			type="button"
			class="{className}-submit"
			disabled={disabled || value.length === 0}
			onclick={() => submit(value)}
		>
			{labels?.submit ?? '확인'}
		</button>
	</div>
{/if}
