<script lang="ts">
	import { onMount } from 'svelte';
	import {
		buildComponentSrcdoc,
		COMPONENT_READY_TYPE,
		ComponentBridge,
		type JsonValue,
		type WireComponent
	} from '@roomkit/shared';
	import { config } from '../stores/config.svelte';
	import { stage } from '../stores/stage.svelte';

	// Sandboxed iframe hosting a component asset (fault/style isolation — the
	// content itself is trusted admin input). Parents push slot events via the
	// exported post(); sendMessage wires are forwarded to every mounted host.
	// Callers must re-create the host when the component changes ({#key}).
	const { component, class: className = '' }: { component: WireComponent; class?: string } =
		$props();

	let iframe = $state<HTMLIFrameElement | null>(null);

	// Callers {#key} this host by componentId, so init-once is safe.
	// svelte-ignore state_referenced_locally
	const bridge = new ComponentBridge(() => iframe?.contentWindow ?? null, {
		props: component.props,
		serverUrl: config.serverUrl,
		slot: component.slot,
		themeId: component.themeId
	});

	export function post(event: string, payload: JsonValue): void {
		bridge.post(event, payload);
	}

	onMount(() => {
		const onWindowMessage = (e: MessageEvent) => {
			if (e.source === iframe?.contentWindow && e.data?.type === COMPONENT_READY_TYPE) {
				bridge.handleReady();
			}
		};
		window.addEventListener('message', onWindowMessage);
		const unsubscribe = stage.subscribeMessages((msg) =>
			bridge.post('message', {
				messageId: msg.messageId,
				messageName: msg.messageName,
				payload: msg.payload
			})
		);
		return () => {
			window.removeEventListener('message', onWindowMessage);
			unsubscribe();
		};
	});
</script>

<iframe
	bind:this={iframe}
	title="component"
	sandbox="allow-scripts"
	srcdoc={buildComponentSrcdoc(component.html)}
	class="absolute inset-0 h-full w-full border-0 bg-transparent {className}"
	style:pointer-events={component.interactive ? 'auto' : 'none'}
></iframe>
