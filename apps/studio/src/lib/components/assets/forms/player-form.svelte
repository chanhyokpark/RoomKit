<script lang="ts">
	import type { Asset } from '@roomkit/shared';
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { listAssets } from '$lib/api/assets';
	import { assetDisplayName } from '../asset-summary';

	let {
		themeId,
		speakerDeviceId = $bindable(),
		screenDeviceId = $bindable(),
		subtitleCss = $bindable()
	}: {
		themeId: string;
		speakerDeviceId: string;
		screenDeviceId: string;
		subtitleCss: string;
	} = $props();

	let devices = $state<Asset[]>([]);
	let devicesLoaded = $state(false);

	$effect(() => {
		listAssets(themeId, { kind: 'device' }).then((result) => {
			devices = result;
			devicesLoaded = true;
		});
	});

	function deviceName(id: string): string | undefined {
		const device = devices.find((candidate) => candidate.id === id);
		return device && assetDisplayName(device);
	}
</script>

{#if devicesLoaded && devices.length === 0}
	<p class="text-sm text-destructive">
		장치 애셋이 없습니다. 플레이어를 만들려면 먼저 장치를 등록하세요.
	</p>
{/if}

<Field.Field>
	<Field.FieldLabel for="player-speaker">스피커 장치</Field.FieldLabel>
	<Select.Root type="single" bind:value={speakerDeviceId}>
		<Select.Trigger id="player-speaker" class="w-full">
			{deviceName(speakerDeviceId) ?? '장치 선택'}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				{#each devices as device (device.id)}
					<Select.Item value={device.id} label={assetDisplayName(device)}>
						{assetDisplayName(device)}
					</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
	<Field.FieldDescription>대사 음성이 재생되는 장치입니다.</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel for="player-screen">스크린 장치</Field.FieldLabel>
	<Select.Root type="single" bind:value={screenDeviceId}>
		<Select.Trigger id="player-screen" class="w-full">
			{deviceName(screenDeviceId) ?? '장치 선택'}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				{#each devices as device (device.id)}
					<Select.Item value={device.id} label={assetDisplayName(device)}>
						{assetDisplayName(device)}
					</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>
	<Field.FieldDescription>자막과 비디오가 표시되는 장치입니다.</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel for="player-subtitle-css">자막 CSS</Field.FieldLabel>
	<Textarea
		id="player-subtitle-css"
		bind:value={subtitleCss}
		rows={4}
		class="font-mono"
		placeholder={'.subtitle { font-size: 2rem; }'}
	/>
	<Field.FieldDescription>
		기본 자막 오버레이(.rk-subtitle)에 적용되는 스타일입니다.
	</Field.FieldDescription>
</Field.Field>
