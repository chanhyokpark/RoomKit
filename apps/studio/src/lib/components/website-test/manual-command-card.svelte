<script lang="ts">
	import PlayIcon from '@lucide/svelte/icons/play';
	import TerminalIcon from '@lucide/svelte/icons/terminal';
	import XIcon from '@lucide/svelte/icons/x';
	import type { CommandType, SequenceEntry } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Spinner } from '$lib/components/ui/spinner';
	import CommandPalette from '$lib/components/editor/command-palette.svelte';
	import CommandParams from '$lib/components/editor/command-params.svelte';
	import { COMMAND_META } from '$lib/components/editor/commands/registry';
	import { useEditorData } from '$lib/components/editor/editor-data.svelte';
	import { useWebsiteTestData } from './website-test-data.svelte';

	const data = useWebsiteTestData();
	const editorData = useEditorData();

	/** Only commands that make sense against the one test device (server-enforced). */
	const MANUAL_ALLOWED: CommandType[] = [
		'playDialogue',
		'stopDialogue',
		'playSfx',
		'stopSfx',
		'playVideo',
		'stopVideo',
		'playBgm',
		'stopBgm',
		'resetDevice',
		'resetAllDevices',
		'sendMessage',
		'showHintCode',
		'hideHintCode'
	];

	let paletteOpen = $state(false);
	let entry = $state<SequenceEntry | null>(null);
	let busy = $state(false);

	function materialize(type: CommandType): void {
		const cmd = COMMAND_META[type].create();
		// Prefill targets: every device/player collapses onto the test device
		// anyway (the server forces it), so the selects start sensible.
		if ('deviceId' in cmd) cmd.deviceId = data.run?.deviceId ?? null;
		if ('playerId' in cmd) cmd.playerId = editorData.byKind('player')[0]?.id ?? null;
		entry = { id: crypto.randomUUID(), ...cmd };
	}

	async function execute(): Promise<void> {
		if (!entry || busy) return;
		busy = true;
		try {
			await data.sendCommand(entry);
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<TerminalIcon class="size-4" />
			수동 커맨드
		</Card.Title>
		<Card.Description>
			커맨드를 골라 즉시 실행합니다. 장치/플레이어 대상은 테스트 장치로 고정됩니다.
		</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if entry === null}
			<Button variant="outline" onclick={() => (paletteOpen = true)}>커맨드 선택…</Button>
		{:else}
			{@const meta = COMMAND_META[entry.type]}
			<div class="rounded-md border p-3">
				<div class="flex items-center gap-2">
					<meta.icon class="size-4" />
					<span class="text-sm font-medium">{meta.label}</span>
					<div class="ml-auto flex items-center gap-1">
						<Button size="sm" variant="ghost" onclick={() => (paletteOpen = true)}>변경</Button>
						<Button
							size="sm"
							variant="ghost"
							aria-label="커맨드 지우기"
							onclick={() => (entry = null)}
						>
							<XIcon />
						</Button>
					</div>
				</div>
				<CommandParams {entry} ownEventId="" onchanged={() => {}} />
			</div>
			<Button disabled={busy} onclick={execute}>
				{#if busy}
					<Spinner data-icon="inline-start" />
				{:else}
					<PlayIcon data-icon="inline-start" />
				{/if}
				실행
			</Button>
		{/if}
	</Card.Content>
</Card.Root>

<CommandPalette bind:open={paletteOpen} allowedTypes={MANUAL_ALLOWED} onselect={materialize} />
