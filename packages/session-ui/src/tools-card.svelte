<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';

	const { model, actions, view } = useSessionUi();
	let hintId = $state('');
	let hintStep = $state('0');
	let hintDeviceId = $state('');
	let busy = $state(false);

	const hints = $derived(assetsOf(model.assets, 'hint'));
	const devices = $derived(assetsOf(model.assets, 'device'));
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
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<LightbulbIcon />{view.simple ? '힌트' : '힌트 테스트'}
		</Card.Title>
		{#if view.simple}
			<Card.Description>힌트 단계를 힌트 장치로 직접 전송합니다.</Card.Description>
		{:else}
			<Card.Description>힌트 단계와 코드 오버레이를 직접 확인합니다.</Card.Description>
		{/if}
	</Card.Header>
	<Card.Content>
		<Field.FieldGroup>
			<Field.Field>
				<Field.FieldLabel>힌트와 단계</Field.FieldLabel>
				<div class="flex flex-wrap items-center gap-2">
					<Select.Root type="single" bind:value={hintId} onValueChange={() => (hintStep = '0')}>
						<Select.Trigger size="sm" class="min-w-0 flex-1 basis-40">
							<span class="truncate">
								{selectedHint
									? `${selectedHint.code ?? '코드 없음'} · ${selectedHint.name}`
									: '힌트 선택'}
							</span>
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
			{#if !view.simple}
				<Field.Field>
					<Field.FieldLabel>코드 오버레이</Field.FieldLabel>
					<div class="flex flex-wrap items-center gap-2">
						<Select.Root type="single" bind:value={hintDeviceId}>
							<Select.Trigger size="sm" class="min-w-0 flex-1 basis-40">
								<span class="truncate">
									{devices.find((device) => device.id === hintDeviceId)?.name ?? '디바이스 선택'}
								</span>
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
			{/if}
		</Field.FieldGroup>
	</Card.Content>
</Card.Root>
