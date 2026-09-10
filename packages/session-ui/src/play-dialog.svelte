<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type { Command, PlayChannel } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';
	import { channelLabels } from './format.js';
	import type { PlayerAsset } from './types.js';

	/**
	 * "+" on a player row: pick a media channel and asset and play it through
	 * that player as a one-off admin command.
	 */
	let { player, open = $bindable(false) }: { player: PlayerAsset; open?: boolean } = $props();

	const { model, actions } = useSessionUi();

	const CHANNELS: PlayChannel[] = ['dialogue', 'bgm', 'sfx', 'video'];

	let channel = $state<PlayChannel>('dialogue');
	let assetId = $state('');
	let loop = $state(false);
	let busy = $state(false);

	/** Channels that have at least one asset to play, in menu order. */
	const channels = $derived(
		CHANNELS.filter((candidate) => assetsOf(model.assets, candidate).length > 0)
	);
	const options = $derived(assetsOf(model.assets, channel));
	const selected = $derived(options.find((option) => option.id === assetId) ?? null);
	const canApply = $derived(!busy && !!assetId && model.session?.state !== 'ended');

	function reset(): void {
		channel = channels[0] ?? 'dialogue';
		assetId = '';
		loop = false;
	}

	// Every open starts from a clean form; the player row remembers nothing.
	$effect(() => {
		if (open) reset();
	});

	function selectChannel(next: PlayChannel): void {
		channel = next;
		assetId = '';
	}

	function command(): Command {
		const playerId = player.id;
		switch (channel) {
			case 'dialogue':
				return {
					type: 'playDialogue',
					dialogueId: assetId,
					playerId,
					waitUntilEnd: false,
					lineCues: []
				};
			case 'bgm':
				return { type: 'playBgm', bgmId: assetId, playerId, loop, waitUntilEnd: false };
			case 'sfx':
				return { type: 'playSfx', sfxId: assetId, playerId, waitUntilEnd: false };
			case 'video':
				return { type: 'playVideo', videoId: assetId, playerId, waitUntilEnd: false };
		}
	}

	async function apply(): Promise<void> {
		if (!canApply) return;
		busy = true;
		try {
			await actions.runCommand(command());
			toast.success(`${channelLabels[channel]} 재생을 시작했습니다.`);
			open = false;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '재생에 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{player.name}에서 재생</Dialog.Title>
			<Dialog.Description>
				미디어 애셋을 골라 이 플레이어로 바로 재생합니다. 실행 결과는 세션 로그에 남습니다.
			</Dialog.Description>
		</Dialog.Header>

		{#if channels.length === 0}
			<p class="text-sm text-muted-foreground">재생할 수 있는 미디어 애셋이 없습니다.</p>
		{:else}
			<Field.FieldGroup>
				<Field.Field>
					<Field.FieldLabel>1. 종류</Field.FieldLabel>
					<div class="flex flex-wrap gap-1.5">
						{#each channels as candidate (candidate)}
							<Button
								size="sm"
								variant={channel === candidate ? 'default' : 'outline'}
								aria-pressed={channel === candidate}
								onclick={() => selectChannel(candidate)}
							>
								{channelLabels[candidate]}
							</Button>
						{/each}
					</div>
				</Field.Field>

				<Field.Field>
					<Field.FieldLabel for="play-asset-{player.id}"
						>2. {channelLabels[channel]} 선택</Field.FieldLabel
					>
					<Select.Root type="single" bind:value={assetId}>
						<Select.Trigger id="play-asset-{player.id}" size="sm" class="min-w-48">
							{selected?.name ?? `${channelLabels[channel]} 선택`}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each options as option (option.id)}
									<Select.Item value={option.id} label={option.name}>{option.name}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</Field.Field>

				{#if channel === 'bgm'}
					<Field.Field>
						<Field.FieldLabel>3. 옵션</Field.FieldLabel>
						<Field.Field orientation="horizontal" class="w-auto">
							<Checkbox id="play-loop-{player.id}" bind:checked={loop} />
							<Field.FieldLabel for="play-loop-{player.id}">반복 재생</Field.FieldLabel>
						</Field.Field>
					</Field.Field>
				{/if}
			</Field.FieldGroup>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={() => (open = false)}>취소</Button>
			<Button disabled={!canApply} onclick={apply}>
				{#if busy}<Spinner data-icon="inline-start" />{/if}
				재생
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
