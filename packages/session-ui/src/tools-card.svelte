<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import PlayIcon from '@lucide/svelte/icons/play';
	import RadioIcon from '@lucide/svelte/icons/radio';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { toast } from 'svelte-sonner';
	import type { Command } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	type Channel = 'bgm' | 'sfx' | 'video' | 'dialogue';
	const channels: Array<{ value: Channel; label: string }> = [
		{ value: 'bgm', label: 'BGM' },
		{ value: 'sfx', label: '효과음' },
		{ value: 'video', label: '비디오' },
		{ value: 'dialogue', label: '대사' }
	];

	const { model, actions } = useSessionUi();
	let channel = $state<Channel>('bgm');
	let mediaId = $state('');
	let playerId = $state('');
	let hintId = $state('');
	let hintStep = $state('0');
	let hintDeviceId = $state('');
	let busy = $state(false);

	const players = $derived(assetsOf(model.assets, 'player'));
	const hints = $derived(assetsOf(model.assets, 'hint'));
	const devices = $derived(assetsOf(model.assets, 'device'));
	const mediaOptions = $derived(assetsOf(model.assets, channel));
	const selectedHint = $derived(hints.find((hint) => hint.id === hintId) ?? null);
	const hintSteps = $derived.by(() => {
		if (!selectedHint) return [];
		const steps = selectedHint.data.steps.map((_, index) => ({
			value: String(index),
			label: `${index + 1}단계`
		}));
		if (selectedHint.data.answer) {
			steps.push({
				value: String(selectedHint.data.steps.length),
				label: '정답'
			});
		}
		return steps;
	});
	const disabled = $derived(
		busy || !model.session || model.session.state === 'created' || model.session.state === 'ended'
	);

	async function run(action: () => Promise<void>, success: string): Promise<void> {
		if (busy) return;
		busy = true;
		try {
			await action();
			toast.success(success);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '요청이 실패했습니다.');
		} finally {
			busy = false;
		}
	}

	function playCommand(): Command | null {
		if (!mediaId || !playerId) return null;
		switch (channel) {
			case 'bgm':
				return {
					type: 'playBgm',
					bgmId: mediaId,
					playerId,
					loop: false,
					waitUntilEnd: false
				};
			case 'sfx':
				return {
					type: 'playSfx',
					sfxId: mediaId,
					playerId,
					waitUntilEnd: false
				};
			case 'video':
				return {
					type: 'playVideo',
					videoId: mediaId,
					playerId,
					waitUntilEnd: false
				};
			case 'dialogue':
				return {
					type: 'playDialogue',
					dialogueId: mediaId,
					playerId,
					waitUntilEnd: false,
					lineCues: []
				};
		}
	}

	function stopCommand(): Command {
		switch (channel) {
			case 'bgm':
				return { type: 'stopBgm', playerId: null, allPlayers: true };
			case 'sfx':
				return { type: 'stopSfx', playerId: null, allPlayers: true };
			case 'video':
				return { type: 'stopVideo', playerId: null, allPlayers: true };
			case 'dialogue':
				return { type: 'stopDialogue', playerId: null, allPlayers: true };
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2"><RadioIcon />미디어 테스트</Card.Title>
		<Card.Description>플레이어 애셋으로 미디어를 직접 재생합니다.</Card.Description>
	</Card.Header>
	<Card.Content>
		<Field.FieldGroup>
			<Field.Field>
				<Field.FieldLabel>재생 채널과 애셋</Field.FieldLabel>
				<div class="flex flex-wrap items-center gap-2">
					<Select.Root type="single" bind:value={channel} onValueChange={() => (mediaId = '')}>
						<Select.Trigger size="sm">
							{channels.find((option) => option.value === channel)?.label}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each channels as option (option.value)}
									<Select.Item value={option.value} label={option.label}>{option.label}</Select.Item
									>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Select.Root type="single" bind:value={mediaId}>
						<Select.Trigger size="sm" class="min-w-40 flex-1">
							{mediaOptions.find((asset) => asset.id === mediaId)?.name ?? '애셋 선택'}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each mediaOptions as asset (asset.id)}
									<Select.Item value={asset.id} label={asset.name}>{asset.name}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Select.Root type="single" bind:value={playerId}>
						<Select.Trigger size="sm" class="min-w-36">
							{players.find((player) => player.id === playerId)?.name ?? '플레이어 선택'}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each players as player (player.id)}
									<Select.Item value={player.id} label={player.name}>{player.name}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
				</div>
			</Field.Field>
			<div class="flex flex-wrap gap-2">
				<Button
					size="sm"
					disabled={disabled || !mediaId || !playerId}
					onclick={() => {
						const command = playCommand();
						if (command) void run(() => actions.runCommand(command), '재생 명령을 보냈습니다.');
					}}
				>
					<PlayIcon data-icon="inline-start" />재생
				</Button>
				<Button
					size="sm"
					variant="outline"
					{disabled}
					onclick={() => run(() => actions.runCommand(stopCommand()), '정지 명령을 보냈습니다.')}
				>
					<SquareIcon data-icon="inline-start" />채널 전체 정지
				</Button>
			</div>
		</Field.FieldGroup>
	</Card.Content>
</Card.Root>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2"><LightbulbIcon />힌트 테스트</Card.Title>
		<Card.Description>힌트 단계와 코드 오버레이를 직접 확인합니다.</Card.Description>
	</Card.Header>
	<Card.Content>
		<Field.FieldGroup>
			<Field.Field>
				<Field.FieldLabel>힌트와 단계</Field.FieldLabel>
				<div class="flex items-center gap-2">
					<Select.Root type="single" bind:value={hintId} onValueChange={() => (hintStep = '0')}>
						<Select.Trigger size="sm" class="min-w-40 flex-1">
							{selectedHint
								? `${selectedHint.code ?? '코드 없음'} · ${selectedHint.name}`
								: '힌트 선택'}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each hints as hint (hint.id)}
									<Select.Item value={hint.id} label={hint.name}>
										{hint.code ? `${hint.code} · ` : ''}{hint.name}
									</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Select.Root type="single" bind:value={hintStep}>
						<Select.Trigger size="sm" class="min-w-24">
							{hintSteps.find((step) => step.value === hintStep)?.label ?? '단계'}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each hintSteps as step (step.value)}
									<Select.Item value={step.value} label={step.label}>{step.label}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Button
						size="sm"
						disabled={disabled || !hintId}
						onclick={() =>
							run(
								() => actions.pushHint({ hintId, step: Number(hintStep) }),
								'힌트를 전송했습니다.'
							)}
					>
						전송
					</Button>
				</div>
			</Field.Field>
			<Field.Field>
				<Field.FieldLabel>코드 오버레이</Field.FieldLabel>
				<div class="flex items-center gap-2">
					<Select.Root type="single" bind:value={hintDeviceId}>
						<Select.Trigger size="sm" class="min-w-40 flex-1">
							{devices.find((device) => device.id === hintDeviceId)?.name ?? '디바이스 선택'}
						</Select.Trigger>
						<Select.Content>
							<Select.Group>
								{#each devices as device (device.id)}
									<Select.Item value={device.id} label={device.name}>{device.name}</Select.Item>
								{/each}
							</Select.Group>
						</Select.Content>
					</Select.Root>
					<Button
						size="sm"
						variant="outline"
						disabled={disabled || !hintId || !hintDeviceId}
						onclick={() =>
							run(
								() =>
									actions.runCommand({
										type: 'showHintCode',
										hintId,
										deviceId: hintDeviceId
									}),
								'힌트 코드를 표시했습니다.'
							)}
					>
						표시
					</Button>
					<Button
						size="sm"
						variant="outline"
						{disabled}
						onclick={() =>
							run(
								() =>
									actions.runCommand({
										type: 'hideHintCode',
										deviceId: null,
										allDevices: true
									}),
								'힌트 코드를 숨겼습니다.'
							)}
					>
						모두 숨김
					</Button>
				</div>
			</Field.Field>
		</Field.FieldGroup>
	</Card.Content>
</Card.Root>
