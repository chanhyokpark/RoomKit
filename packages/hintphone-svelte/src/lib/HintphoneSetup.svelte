<!--
  Sets up the RoomKit connection (client or helper, auto-detected) and shares
  it via context with the other components. In client mode without a device
  code it shows a minimal unstyled <dialog> asking for one (replace it with
  the `codeDialog` snippet, style it via `.rk-code-dialog*`).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import {
		HintphoneConnection,
		HintphoneController,
		type HintphoneConnectionOptions
	} from './core.js';
	import { createHintphoneContext } from './context.svelte.js';

	let {
		options = {},
		children,
		codeDialog,
		dialogClassName = 'rk-code-dialog',
		dialogLabels
	}: {
		/** Connection options, read once on mount. */
		options?: HintphoneConnectionOptions;
		children?: Snippet;
		/** Replaces the built-in device-code dialog; call the argument with the code. */
		codeDialog?: Snippet<[(code: string) => void]>;
		dialogClassName?: string;
		dialogLabels?: { title?: string; placeholder?: string; submit?: string };
	} = $props();

	const ctx = createHintphoneContext();
	let codeValue = $state('');

	$effect(() => {
		// Options are read once per mount by design; reconnecting on every
		// change would tear down the socket mid-session.
		const connection = new HintphoneConnection(options);
		const controller = new HintphoneController(connection);
		const unsubscribe = controller.subscribe(() => (ctx.snapshot = controller.snapshot));
		ctx.connection = connection;
		ctx.controller = controller;
		ctx.snapshot = controller.snapshot;
		connection.connect();
		return () => {
			unsubscribe();
			controller.destroy();
			connection.destroy();
			ctx.connection = null;
			ctx.controller = null;
		};
	});

	const setCode = (code: string) => ctx.connection?.setDeviceCode(code);

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (codeValue.trim()) setCode(codeValue);
	}
</script>

{@render children?.()}

{#if ctx.snapshot.connectionState === 'needs-code'}
	{#if codeDialog}
		{@render codeDialog(setCode)}
	{:else}
		<dialog open class={dialogClassName}>
			<form class="{dialogClassName}-form" onsubmit={handleSubmit}>
				<p class="{dialogClassName}-title">{dialogLabels?.title ?? '장치 코드 입력'}</p>
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="{dialogClassName}-input"
					bind:value={codeValue}
					placeholder={dialogLabels?.placeholder ?? '장치 코드'}
					autofocus
				/>
				<button type="submit" class="{dialogClassName}-submit">
					{dialogLabels?.submit ?? '연결'}
				</button>
			</form>
		</dialog>
	{/if}
{/if}
