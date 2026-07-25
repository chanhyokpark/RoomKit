<script lang="ts">
	import type { Asset } from '@roomkit/shared';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Textarea } from '$lib/components/ui/textarea';
	import { listAssets } from '$lib/api/assets';
	import { assetDisplayName } from '../asset-summary';

	let {
		themeId,
		speakerDeviceId = $bindable(),
		screenDeviceId = $bindable(),
		subtitleCss = $bindable(),
		dialogueDuckPercent = $bindable(),
		sfxDuckPercent = $bindable()
	}: {
		themeId: string;
		speakerDeviceId: string;
		screenDeviceId: string;
		subtitleCss: string;
		/** BGM volume (%) while dialogue plays; null = no ducking. */
		dialogueDuckPercent: number | null;
		/** BGM volume (%) while any SFX plays; null = no ducking. */
		sfxDuckPercent: number | null;
	} = $props();

	/** Empty input = no ducking (null); otherwise clamp to 0..100. */
	function parseDuckPercent(text: string): number | null {
		if (text.trim() === '') return null;
		const num = Number(text);
		if (!Number.isFinite(num)) return null;
		return Math.max(0, Math.min(100, Math.round(num)));
	}

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

<div class="grid grid-cols-2 gap-3">
	<Field.Field>
		<Field.FieldLabel for="player-dialogue-duck">대사 중 BGM 볼륨 (%)</Field.FieldLabel>
		<Input
			id="player-dialogue-duck"
			type="number"
			min="0"
			max="100"
			placeholder="덕킹 없음"
			value={dialogueDuckPercent ?? ''}
			onchange={(changeEvent) => {
				dialogueDuckPercent = parseDuckPercent(changeEvent.currentTarget.value);
			}}
		/>
		<Field.FieldDescription>
			대사 재생 중 BGM을 이 볼륨으로 낮춥니다. 비우면 낮추지 않습니다.
		</Field.FieldDescription>
	</Field.Field>
	<Field.Field>
		<Field.FieldLabel for="player-sfx-duck">효과음 중 BGM 볼륨 (%)</Field.FieldLabel>
		<Input
			id="player-sfx-duck"
			type="number"
			min="0"
			max="100"
			placeholder="덕킹 없음"
			value={sfxDuckPercent ?? ''}
			onchange={(changeEvent) => {
				sfxDuckPercent = parseDuckPercent(changeEvent.currentTarget.value);
			}}
		/>
		<Field.FieldDescription>
			효과음 재생 중 BGM을 이 볼륨으로 낮춥니다. 비우면 낮추지 않습니다.
		</Field.FieldDescription>
	</Field.Field>
</div>

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
