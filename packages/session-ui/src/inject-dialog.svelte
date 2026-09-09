<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import type { Command, JsonValue, MessageField } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';
	import { assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';
	import type { DeviceAsset } from './types.js';

	/**
	 * "+" on a device row: pick an asset kind, the asset, its options, and
	 * apply it to that device as a one-off admin command.
	 */
	let { device, open = $bindable(false) }: { device: DeviceAsset; open?: boolean } = $props();

	const { model, actions } = useSessionUi();

	type Kind = 'dialogue' | 'bgm' | 'sfx' | 'video' | 'website' | 'message' | 'state' | 'hintCode';
	const MEDIA_KINDS = new Set<Kind>(['dialogue', 'bgm', 'sfx', 'video']);
	const kindLabels: Record<Kind, string> = {
		dialogue: '대사',
		bgm: 'BGM',
		sfx: '효과음',
		video: '비디오',
		website: '웹사이트',
		message: '메시지',
		state: '상태',
		hintCode: '힌트 코드'
	};

	let kind = $state<Kind>('website');
	let assetId = $state('');
	let playerId = $state('');
	let loop = $state(false);
	let values = $state<Record<string, string>>({});
	let query = $state<Array<{ key: string; value: string }>>([]);
	let busy = $state(false);

	const status = $derived(model.statusOf(device.id));
	/** Players whose speaker or screen is this device — media plays through them. */
	const players = $derived(
		assetsOf(model.assets, 'player').filter(
			(player) =>
				player.data.speakerDeviceId === device.id || player.data.screenDeviceId === device.id
		)
	);
	const registeredMessages = $derived(status?.helperMessages ?? []);
	const registeredStates = $derived(status?.helperStates ?? []);

	interface Option {
		id: string;
		label: string;
		/** The loaded website registered this name via Helper. */
		registered: boolean;
	}

	function optionsFor(target: Kind): Option[] {
		switch (target) {
			case 'website':
				return assetsOf(model.assets, 'website').map((site) => ({
					id: site.id,
					label: site.name,
					registered: false
				}));
			case 'message': {
				const all = assetsOf(model.assets, 'message');
				const list =
					registeredMessages.length > 0
						? all.filter((message) => registeredMessages.includes(message.name))
						: all;
				return list.map((message) => ({
					id: message.id,
					label: message.data.displayName || message.name,
					registered: registeredMessages.includes(message.name)
				}));
			}
			case 'state': {
				const all = assetsOf(model.assets, 'state');
				const list =
					registeredStates.length > 0
						? all.filter((state) => registeredStates.includes(state.name))
						: all;
				return list.map((state) => ({
					id: state.id,
					label: state.data.displayName || state.name,
					registered: registeredStates.includes(state.name)
				}));
			}
			case 'hintCode':
				return assetsOf(model.assets, 'hint').map((hint) => ({
					id: hint.id,
					label: hint.code ? `${hint.code} · ${hint.name}` : hint.name,
					registered: false
				}));
			default:
				return assetsOf(model.assets, target).map((asset) => ({
					id: asset.id,
					label: asset.name,
					registered: false
				}));
		}
	}

	/** Kinds this device can take right now, in menu order. */
	const kinds = $derived(
		(Object.keys(kindLabels) as Kind[]).filter((candidate) => {
			if (MEDIA_KINDS.has(candidate) && players.length === 0) return false;
			return optionsFor(candidate).length > 0;
		})
	);
	const options = $derived(optionsFor(kind));
	const selected = $derived(options.find((option) => option.id === assetId) ?? null);
	const fields = $derived.by((): MessageField[] => {
		if (!assetId) return [];
		if (kind === 'message') {
			return assetsOf(model.assets, 'message').find((m) => m.id === assetId)?.data.fields ?? [];
		}
		if (kind === 'state') {
			return assetsOf(model.assets, 'state').find((s) => s.id === assetId)?.data.fields ?? [];
		}
		return [];
	});
	const needsPlayer = $derived(MEDIA_KINDS.has(kind));
	const canApply = $derived(
		!busy && !!assetId && (!needsPlayer || !!playerId) && model.session?.state !== 'ended'
	);

	function reset(): void {
		kind = kinds[0] ?? 'website';
		assetId = '';
		playerId = players[0]?.id ?? '';
		loop = false;
		values = {};
		query = [];
	}

	// Every open starts from a clean form; the device row remembers nothing.
	$effect(() => {
		if (open) reset();
	});

	function selectKind(next: Kind): void {
		kind = next;
		assetId = '';
		values = {};
		query = [];
	}

	/** Raw form strings → typed values per the field schema; null after a toast on bad JSON. */
	function parseValues(): Record<string, JsonValue> | null {
		const parsed: Record<string, JsonValue> = {};
		for (const field of fields) {
			const text = values[field.key] ?? '';
			if (text === '' && !field.required) continue;
			try {
				parsed[field.key] =
					field.type === 'number'
						? Number(text)
						: field.type === 'boolean'
							? text === 'true'
							: field.type === 'json'
								? (JSON.parse(text || 'null') as JsonValue)
								: text;
			} catch {
				toast.error(`필드 "${field.label || field.key}"의 JSON이 올바르지 않습니다.`);
				return null;
			}
		}
		return parsed;
	}

	function command(): Command | null {
		const deviceId = device.id;
		switch (kind) {
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
			case 'website':
				return {
					type: 'navigate',
					deviceId,
					websiteId: assetId,
					query: query.filter((pair) => pair.key.trim() !== '')
				};
			case 'message': {
				const parsed = parseValues();
				if (!parsed) return null;
				return {
					type: 'sendMessage',
					deviceId,
					messageId: assetId,
					values: parsed,
					waitUntilEnd: false
				};
			}
			case 'state': {
				const parsed = parseValues();
				if (!parsed) return null;
				return { type: 'setState', deviceId, stateId: assetId, values: parsed };
			}
			case 'hintCode':
				return { type: 'showHintCode', hintId: assetId, deviceId };
		}
	}

	async function apply(): Promise<void> {
		if (!canApply) return;
		const cmd = command();
		if (!cmd) return;
		busy = true;
		try {
			await actions.runCommand(cmd);
			toast.success(`${kindLabels[kind]}을(를) 적용했습니다.`);
			open = false;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '적용에 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{device.data.displayName || device.name}에 애셋 주입</Dialog.Title>
			<Dialog.Description>
				애셋을 골라 이 디바이스에 바로 적용합니다. 실행 결과는 세션 로그에 남습니다.
			</Dialog.Description>
		</Dialog.Header>

		{#if kinds.length === 0}
			<p class="text-sm text-muted-foreground">이 디바이스에 적용할 수 있는 애셋이 없습니다.</p>
		{:else}
			<Field.FieldGroup>
				<Field.Field>
					<Field.FieldLabel>1. 애셋 종류</Field.FieldLabel>
					<div class="flex flex-wrap gap-1.5">
						{#each kinds as candidate (candidate)}
							<Button
								size="sm"
								variant={kind === candidate ? 'default' : 'outline'}
								aria-pressed={kind === candidate}
								onclick={() => selectKind(candidate)}
							>
								{kindLabels[candidate]}
							</Button>
						{/each}
					</div>
				</Field.Field>

				<Field.Field>
					<Field.FieldLabel for="inject-asset-{device.id}"
						>2. {kindLabels[kind]} 선택</Field.FieldLabel
					>
					<div class="flex flex-wrap items-center gap-2">
						<Select.Root type="single" bind:value={assetId} onValueChange={() => (values = {})}>
							<Select.Trigger id="inject-asset-{device.id}" size="sm" class="min-w-48 flex-1">
								{selected?.label ?? `${kindLabels[kind]} 선택`}
							</Select.Trigger>
							<Select.Content>
								<Select.Group>
									{#each options as option (option.id)}
										<Select.Item value={option.id} label={option.label}>
											{option.label}{option.registered ? ' ✓' : ''}
										</Select.Item>
									{/each}
								</Select.Group>
							</Select.Content>
						</Select.Root>
						{#if needsPlayer && players.length > 1}
							<Select.Root type="single" bind:value={playerId}>
								<Select.Trigger size="sm" class="min-w-36" aria-label="플레이어">
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
						{/if}
					</div>
					{#if kind === 'message' && registeredMessages.length > 0}
						<Field.FieldDescription
							>페이지 등록: {registeredMessages.join(', ')}</Field.FieldDescription
						>
					{:else if kind === 'state' && registeredStates.length > 0}
						<Field.FieldDescription
							>페이지 등록: {registeredStates.join(', ')}</Field.FieldDescription
						>
					{:else if needsPlayer && players.length === 1}
						<Field.FieldDescription>플레이어: {players[0].name}</Field.FieldDescription>
					{/if}
				</Field.Field>

				{#if kind === 'bgm' || fields.length > 0 || kind === 'website' || kind === 'state'}
					<Field.Field>
						<Field.FieldLabel>3. 옵션</Field.FieldLabel>
						{#if kind === 'bgm'}
							<Field.Field orientation="horizontal" class="w-auto">
								<Checkbox id="inject-loop-{device.id}" bind:checked={loop} />
								<Field.FieldLabel for="inject-loop-{device.id}">반복 재생</Field.FieldLabel>
							</Field.Field>
						{/if}
						{#if fields.length > 0}
							<Field.FieldGroup class="gap-2">
								{#each fields as field (field.key)}
									<Field.Field orientation="horizontal">
										<Field.FieldLabel for="inject-field-{device.id}-{field.key}" class="w-32">
											{field.label || field.key}{field.required ? ' *' : ''}
										</Field.FieldLabel>
										{#if field.type === 'boolean'}
											<Select.Root type="single" bind:value={values[field.key]}>
												<Select.Trigger
													id="inject-field-{device.id}-{field.key}"
													size="sm"
													class="flex-1"
												>
													{values[field.key] || '선택 안 함'}
												</Select.Trigger>
												<Select.Content>
													<Select.Group>
														<Select.Item value="true" label="true">true</Select.Item>
														<Select.Item value="false" label="false">false</Select.Item>
													</Select.Group>
												</Select.Content>
											</Select.Root>
										{:else}
											<Input
												id="inject-field-{device.id}-{field.key}"
												placeholder={field.type}
												bind:value={values[field.key]}
											/>
										{/if}
									</Field.Field>
								{/each}
							</Field.FieldGroup>
						{/if}
						{#if kind === 'website'}
							<div class="flex flex-col gap-1.5">
								{#each query as pair, index (index)}
									<div class="flex items-center gap-1.5">
										<Input
											placeholder="키"
											aria-label="쿼리 키"
											class="flex-1"
											bind:value={pair.key}
										/>
										<Input
											placeholder="값"
											aria-label="쿼리 값"
											class="flex-1"
											bind:value={pair.value}
										/>
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label="쿼리 삭제"
											onclick={() => (query = query.filter((_, i) => i !== index))}
										>
											<TrashIcon />
										</Button>
									</div>
								{/each}
								<Button
									variant="outline"
									size="sm"
									class="self-start"
									onclick={() => (query = [...query, { key: '', value: '' }])}
								>
									<PlusIcon data-icon="inline-start" />쿼리 파라미터
								</Button>
							</div>
						{/if}
						{#if kind === 'state'}
							<Field.FieldDescription>
								상태는 장치가 다시 접속해도 유지됩니다. 일시적인 효과에는 메시지를 쓰세요.
							</Field.FieldDescription>
						{/if}
					</Field.Field>
				{/if}
			</Field.FieldGroup>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" disabled={busy} onclick={() => (open = false)}>취소</Button>
			<Button disabled={!canApply} onclick={apply}>
				{#if busy}<Spinner data-icon="inline-start" />{/if}
				적용
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
