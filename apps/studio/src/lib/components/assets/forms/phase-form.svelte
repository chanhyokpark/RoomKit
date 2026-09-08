<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Asset } from '@roomkit/shared';
	import { listAssets } from '$lib/api/assets';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import FieldValuesEditor from '$lib/components/editor/field-values-editor.svelte';
	import { assetDisplayName } from '../asset-summary';
	import type { DraftBgmSlot, DraftStateSlot, DraftWebsiteSlot } from '../types';

	let {
		themeId,
		orderText = $bindable(),
		deviceStates = $bindable(),
		deviceWebsites = $bindable(),
		playerBgms = $bindable()
	}: {
		themeId: string;
		orderText: string | number | null;
		deviceStates: DraftStateSlot[];
		deviceWebsites: DraftWebsiteSlot[];
		playerBgms: DraftBgmSlot[];
	} = $props();

	// Self-loaded: the asset editor has no theme-wide asset context here.
	let assets = $state<Asset[]>([]);
	$effect(() => {
		void listAssets(themeId).then((rows) => (assets = rows));
	});

	const devices = $derived(assets.filter((a) => a.kind === 'device'));
	const players = $derived(assets.filter((a) => a.kind === 'player'));
	const states = $derived(assets.filter((a) => a.kind === 'state'));
	const websites = $derived(assets.filter((a) => a.kind === 'website'));
	const bgms = $derived(assets.filter((a) => a.kind === 'bgm'));

	type Mode = 'keep' | 'none' | 'set';
	const MODE_LABELS: Record<Mode, string> = { keep: '유지', none: '없음', set: '지정' };
	const MODES: Mode[] = ['keep', 'none', 'set'];

	function stateSlot(deviceId: string): DraftStateSlot | undefined {
		return deviceStates.find((slot) => slot.deviceId === deviceId);
	}
	function websiteSlot(deviceId: string): DraftWebsiteSlot | undefined {
		return deviceWebsites.find((slot) => slot.deviceId === deviceId);
	}
	function bgmSlot(playerId: string): DraftBgmSlot | undefined {
		return playerBgms.find((slot) => slot.playerId === playerId);
	}

	function setStateMode(deviceId: string, mode: Mode): void {
		const rest = deviceStates.filter((slot) => slot.deviceId !== deviceId);
		if (mode === 'none') rest.push({ deviceId, mode: 'none' });
		if (mode === 'set') rest.push({ deviceId, mode: 'set', stateId: '', values: {} });
		deviceStates = rest;
	}
	function setWebsiteMode(deviceId: string, mode: Mode): void {
		const rest = deviceWebsites.filter((slot) => slot.deviceId !== deviceId);
		if (mode === 'none') rest.push({ deviceId, mode: 'none' });
		if (mode === 'set') rest.push({ deviceId, mode: 'set', websiteId: '', query: [] });
		deviceWebsites = rest;
	}
	function setBgmMode(playerId: string, mode: Mode): void {
		const rest = playerBgms.filter((slot) => slot.playerId !== playerId);
		if (mode === 'none') rest.push({ playerId, mode: 'none' });
		if (mode === 'set') rest.push({ playerId, mode: 'set', bgmId: '' });
		playerBgms = rest;
	}

	function stateFields(stateId: string) {
		const asset = states.find((s) => s.id === stateId);
		return asset?.kind === 'state' ? asset.data.fields : [];
	}
	function nameOf(list: Asset[], id: string, fallback: string): string {
		const asset = list.find((a) => a.id === id);
		return asset ? assetDisplayName(asset) : id ? '삭제된 애셋' : fallback;
	}
</script>

{#snippet modeSelect(value: Mode, onchange: (mode: Mode) => void, label: string)}
	<Select.Root type="single" {value} onValueChange={(v) => onchange(v as Mode)}>
		<Select.Trigger size="sm" class="w-24 shrink-0" aria-label={label}>
			{MODE_LABELS[value]}
		</Select.Trigger>
		<Select.Content>
			{#each MODES as mode (mode)}
				<Select.Item value={mode} label={MODE_LABELS[mode]}>{MODE_LABELS[mode]}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

{#snippet assetSelect(
	list: Asset[],
	value: string,
	onchange: (id: string) => void,
	placeholder: string
)}
	<Select.Root type="single" {value} onValueChange={(v) => onchange(v)}>
		<Select.Trigger size="sm" class="min-w-40 flex-1" aria-label={placeholder}>
			{nameOf(list, value, placeholder)}
		</Select.Trigger>
		<Select.Content>
			{#each list as asset (asset.id)}
				<Select.Item value={asset.id} label={assetDisplayName(asset)}>
					{assetDisplayName(asset)}
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
{/snippet}

<Field.Field>
	<Field.FieldLabel for="phase-order">순서</Field.FieldLabel>
	<Input id="phase-order" type="number" step="1" bind:value={orderText} placeholder="예: 1" />
	<Field.FieldDescription>게임 진행 순서입니다. 낮을수록 먼저 옵니다.</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>페이즈 시작 시 적용</Field.FieldLabel>
	<Field.FieldDescription>
		페이즈에 들어갈 때 장치 상태·웹사이트와 플레이어 BGM을 맞춥니다. 이미 같은 화면·BGM이면 다시
		시작하지 않고, 등록하지 않은(유지) 항목은 그대로 둡니다. 오프라인이었던 장치도 접속하면 이
		설정을 받습니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>장치 상태</Field.FieldLabel>
	{#if devices.length === 0}
		<p class="text-xs text-muted-foreground">장치 애셋이 없습니다.</p>
	{/if}
	<div class="flex flex-col gap-2">
		{#each devices as device (device.id)}
			{@const slot = stateSlot(device.id)}
			<div class="flex flex-col gap-1.5 rounded-md border p-2">
				<div class="flex items-center gap-2">
					<span class="w-32 truncate text-sm">{assetDisplayName(device)}</span>
					{@render modeSelect(
						slot?.mode ?? 'keep',
						(mode) => setStateMode(device.id, mode),
						`${assetDisplayName(device)} 상태 모드`
					)}
					{#if slot?.mode === 'set'}
						{@render assetSelect(
							states,
							slot.stateId,
							(id) => {
								slot.stateId = id;
								slot.values = {};
							},
							'상태 선택'
						)}
					{/if}
				</div>
				{#if slot?.mode === 'set' && slot.stateId}
					<FieldValuesEditor
						fields={stateFields(slot.stateId)}
						values={slot.values}
						onchanged={() => {}}
						emptyText="이 상태에는 입력할 필드가 없습니다."
					/>
				{/if}
			</div>
		{/each}
	</div>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>장치 웹사이트</Field.FieldLabel>
	<div class="flex flex-col gap-2">
		{#each devices as device (device.id)}
			{@const slot = websiteSlot(device.id)}
			<div class="flex flex-col gap-1.5 rounded-md border p-2">
				<div class="flex items-center gap-2">
					<span class="w-32 truncate text-sm">{assetDisplayName(device)}</span>
					{@render modeSelect(
						slot?.mode ?? 'keep',
						(mode) => setWebsiteMode(device.id, mode),
						`${assetDisplayName(device)} 웹사이트 모드`
					)}
					{#if slot?.mode === 'set'}
						{@render assetSelect(websites, slot.websiteId, (id) => (slot.websiteId = id), '웹사이트 선택')}
					{/if}
				</div>
				{#if slot?.mode === 'set'}
					<div class="flex flex-col gap-1.5">
						{#each slot.query as pair, i (i)}
							<div class="flex items-center gap-1.5">
								<Input class="flex-1 font-mono" placeholder="key" bind:value={pair.key} />
								<Input
									class="flex-1 font-mono"
									placeholder="value ({'{{vars.x}}'} 지원)"
									bind:value={pair.value}
								/>
								<Button
									variant="ghost"
									size="icon"
									aria-label="쿼리 삭제"
									onclick={() => (slot.query = slot.query.filter((_, idx) => idx !== i))}
								>
									<XIcon class="size-4" />
								</Button>
							</div>
						{/each}
						<Button
							variant="outline"
							size="sm"
							class="self-start"
							onclick={() => (slot.query = [...slot.query, { key: '', value: '' }])}
						>
							<PlusIcon class="size-4" /> 쿼리 파라미터 추가
						</Button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</Field.Field>

<Field.Field>
	<Field.FieldLabel>플레이어 BGM</Field.FieldLabel>
	{#if players.length === 0}
		<p class="text-xs text-muted-foreground">플레이어 애셋이 없습니다.</p>
	{/if}
	<div class="flex flex-col gap-2">
		{#each players as player (player.id)}
			{@const slot = bgmSlot(player.id)}
			<div class="flex items-center gap-2 rounded-md border p-2">
				<span class="w-32 truncate text-sm">{assetDisplayName(player)}</span>
				{@render modeSelect(
					slot?.mode ?? 'keep',
					(mode) => setBgmMode(player.id, mode),
					`${assetDisplayName(player)} BGM 모드`
				)}
				{#if slot?.mode === 'set'}
					{@render assetSelect(bgms, slot.bgmId, (id) => (slot.bgmId = id), 'BGM 선택')}
					<span class="text-xs text-muted-foreground">반복 재생</span>
				{/if}
			</div>
		{/each}
	</div>
</Field.Field>
