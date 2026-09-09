<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RouterIcon from '@lucide/svelte/icons/router';
	import XIcon from '@lucide/svelte/icons/x';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type {
		Command,
		JsonValue,
		MessageField,
		PlayChannel,
		PlayingMedia
	} from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { assetName, assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';
	import type { MessageAsset, StateAsset } from './types.js';

	const { model, actions, view } = useSessionUi();
	const expanded = new SvelteSet<string>();
	const busyKeys = new SvelteSet<string>();

	interface MessageForm {
		messageId: string;
		values: Record<string, string>;
		wait: boolean;
	}

	interface StateForm {
		stateId: string;
		values: Record<string, string>;
	}

	let navigation = $state<Record<string, string>>({});
	let messageForms = $state<Record<string, MessageForm>>({});
	let stateForms = $state<Record<string, StateForm>>({});
	let callbackResults = $state<Record<string, 'running' | 'ok' | 'fail'>>({});

	const allDevices = $derived(assetsOf(model.assets, 'device'));
	const websites = $derived(assetsOf(model.assets, 'website'));
	const messages = $derived(assetsOf(model.assets, 'message'));
	const states = $derived(assetsOf(model.assets, 'state'));
	const codeDeviceIds = $derived(new Set(model.testDeviceCodes.map((entry) => entry.deviceId)));
	const devices = $derived(
		codeDeviceIds.size > 0
			? allDevices.filter((device) => codeDeviceIds.has(device.id))
			: allDevices
	);
	const codeByDevice = $derived(
		new Map(model.testDeviceCodes.map((entry) => [entry.deviceId, entry.code]))
	);
	const media = $derived(model.media);
	const websiteByDevice = $derived(
		new Map((media?.websites ?? []).map((website) => [website.deviceId, website]))
	);
	const stateByDevice = $derived(
		new Map((media?.states ?? []).map((entry) => [entry.deviceId, entry]))
	);
	const playingByDevice = $derived.by(() => {
		const result = new Map<string, PlayingMedia[]>();
		for (const entry of media?.playing ?? []) {
			const playing = result.get(entry.deviceId);
			if (playing) playing.push(entry);
			else result.set(entry.deviceId, [entry]);
		}
		return result;
	});

	const channelLabels: Record<PlayChannel, string> = {
		bgm: 'BGM',
		sfx: '효과음',
		dialogue: '대사',
		video: '비디오'
	};

	const stopTypes: Record<PlayChannel, Command['type']> = {
		bgm: 'stopBgm',
		sfx: 'stopSfx',
		dialogue: 'stopDialogue',
		video: 'stopVideo'
	};

	/**
	 * Per-device forms are created when a row is expanded (an event handler),
	 * never from the template: writing state inside `{@const}` / `$derived`
	 * is a Svelte `state_unsafe_mutation` error.
	 */
	function ensureForms(deviceId: string): void {
		messageForms[deviceId] ??= { messageId: '', values: {}, wait: false };
		stateForms[deviceId] ??= { stateId: '', values: {} };
	}

	function toggleExpanded(deviceId: string): void {
		if (expanded.has(deviceId)) {
			expanded.delete(deviceId);
			return;
		}
		ensureForms(deviceId);
		expanded.add(deviceId);
	}

	function formFor(deviceId: string): MessageForm {
		return messageForms[deviceId];
	}

	function messagesFor(deviceId: string): MessageAsset[] {
		const registered = model.statusOf(deviceId)?.helperMessages;
		if (!registered || registered.length === 0) return messages;
		return messages.filter((message) => registered.includes(message.name));
	}

	function stateFormFor(deviceId: string): StateForm {
		return stateForms[deviceId];
	}

	function statesFor(deviceId: string): StateAsset[] {
		const registered = model.statusOf(deviceId)?.helperStates;
		if (!registered || registered.length === 0) return states;
		return states.filter((state) => registered.includes(state.name));
	}

	/** Raw form strings → typed values per the field schema; null after a toast on bad JSON. */
	function parseValues(
		fields: MessageField[],
		raw: Record<string, string>
	): Record<string, JsonValue> | null {
		const values: Record<string, JsonValue> = {};
		for (const field of fields) {
			const text = raw[field.key] ?? '';
			if (text === '' && !field.required) continue;
			try {
				values[field.key] =
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
		return values;
	}

	async function run(key: string, action: () => Promise<void>, success?: string): Promise<void> {
		if (busyKeys.has(key)) return;
		busyKeys.add(key);
		try {
			await action();
			if (success) toast.success(success);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '요청이 실패했습니다.');
		} finally {
			busyKeys.delete(key);
		}
	}

	async function copyCode(code: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(code);
			toast.success('코드가 복사되었습니다.');
		} catch {
			toast.error('클립보드에 접근하지 못했습니다.');
		}
	}

	function setDeviceState(deviceId: string): void {
		const form = stateFormFor(deviceId);
		const state = states.find((candidate) => candidate.id === form.stateId);
		if (!state) return;
		const values = parseValues(state.data.fields, form.values);
		if (!values) return;
		void run(`state:${deviceId}`, () =>
			actions.runCommand({ type: 'setState', deviceId, stateId: state.id, values })
		);
	}

	function clearDeviceState(deviceId: string): void {
		void run(`state:${deviceId}`, () =>
			actions.runCommand({ type: 'clearState', deviceId, allDevices: false })
		);
	}

	function sendMessage(deviceId: string): void {
		const form = formFor(deviceId);
		const message = messages.find((candidate) => candidate.id === form.messageId);
		if (!message) return;
		const values = parseValues(message.data.fields, form.values);
		if (!values) return;
		void run(`message:${deviceId}`, () =>
			actions.runCommand({
				type: 'sendMessage',
				deviceId,
				messageId: message.id,
				values,
				waitUntilEnd: form.wait
			})
		);
	}

	async function callback(deviceId: string, name: string): Promise<void> {
		const key = `${deviceId}:${name}`;
		callbackResults[key] = 'running';
		try {
			const result = await actions.runTestCallback(deviceId, name);
			callbackResults[key] = result.ok ? 'ok' : 'fail';
			if (!result.ok) toast.error(`콜백 "${name}" 실행에 실패했습니다.`);
		} catch (error) {
			callbackResults[key] = 'fail';
			toast.error(error instanceof Error ? error.message : '콜백 실행에 실패했습니다.');
		}
	}

	function stopMedia(entry: PlayingMedia): Promise<void> {
		return actions.runCommand({
			type: stopTypes[entry.channel],
			playerId: entry.playerId,
			allPlayers: false
		} as Command);
	}
</script>

{#snippet valueInputs(values: Record<string, string>, fields: MessageField[], prefix: string)}
	<Field.FieldGroup class="gap-2">
		{#each fields as field (field.key)}
			<Field.Field orientation="horizontal">
				<Field.FieldLabel for="{prefix}-{field.key}" class="w-32">
					{field.label || field.key}{field.required ? ' *' : ''}
				</Field.FieldLabel>
				{#if field.type === 'boolean'}
					<Select.Root type="single" bind:value={values[field.key]}>
						<Select.Trigger id="{prefix}-{field.key}" size="sm" class="flex-1">
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
						id="{prefix}-{field.key}"
						placeholder={field.type}
						bind:value={values[field.key]}
					/>
				{/if}
			</Field.Field>
		{/each}
	</Field.FieldGroup>
{/snippet}

{#if view.simple}
	<!-- Simple mode: connection state only; nothing to expand or operate. -->
	<Card.Root class="md:col-span-2">
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><RouterIcon />디바이스</Card.Title>
		</Card.Header>
		<Card.Content class="flex flex-col gap-2">
			{#if devices.length === 0}
				<p class="text-sm text-muted-foreground">이 세션에 디바이스가 없습니다.</p>
			{/if}
			{#each devices as device (device.id)}
				{@const status = model.statusOf(device.id)}
				<div class="flex items-center gap-2 rounded-md border px-3 py-2">
					<span class={cn('size-2 rounded-full', status?.online ? 'bg-primary' : 'bg-muted')}
					></span>
					<span class="truncate text-sm font-medium">{device.data.displayName || device.name}</span>
					{#if device.data.isHintDevice}<Badge variant="secondary">힌트</Badge>{/if}
					<Badge variant={status?.online ? 'outline' : 'secondary'} class="ml-auto">
						{status?.online ? '온라인' : '오프라인'}
					</Badge>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
{:else}
	<Card.Root class="md:col-span-2">
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><RouterIcon />디바이스</Card.Title>
			<Card.Description>
				연결, 웹사이트, 상태, Helper 등록 항목과 미디어를 한곳에서 확인하고 조작합니다.
			</Card.Description>
			<Card.Action>
				<Button
					size="sm"
					variant="outline"
					disabled={busyKeys.has('reset-all') || model.session?.state === 'ended'}
					onclick={() => run('reset-all', actions.resetDevices, '모든 디바이스를 초기화했습니다.')}
				>
					<RotateCcwIcon data-icon="inline-start" />전체 초기화
				</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content class="flex flex-col gap-2.5">
			{#if devices.length === 0}
				<p class="text-sm text-muted-foreground">이 세션에 디바이스가 없습니다.</p>
			{/if}
			{#each devices as device (device.id)}
				{@const status = model.statusOf(device.id)}
				{@const currentWebsite = websiteByDevice.get(device.id)}
				{@const currentState = stateByDevice.get(device.id)}
				{@const currentMedia = playingByDevice.get(device.id) ?? []}
				{@const code = codeByDevice.get(device.id)}
				<div class="rounded-md border">
					<button
						type="button"
						class="flex w-full items-center gap-2 px-3 py-2 text-left"
						onclick={() => toggleExpanded(device.id)}
					>
						<span class={cn('size-2 rounded-full', status?.online ? 'bg-primary' : 'bg-muted')}
						></span>
						<span class="truncate text-sm font-medium"
							>{device.data.displayName || device.name}</span
						>
						{#if device.data.isHintDevice}<Badge variant="secondary">힌트</Badge>{/if}
						{#if code}<code class="font-mono text-xs text-muted-foreground">{code}</code>{/if}
						<Badge variant={status?.online ? 'outline' : 'secondary'} class="ml-auto">
							{status?.online ? '온라인' : '오프라인'}
						</Badge>
						{#if expanded.has(device.id)}
							<ChevronDownIcon class="size-4 text-muted-foreground" />
						{:else}
							<ChevronRightIcon class="size-4 text-muted-foreground" />
						{/if}
					</button>

					{#if currentWebsite || currentState || currentMedia.length > 0}
						<div class="flex flex-col gap-1.5 border-t px-3 py-2">
							{#if currentState}
								<div class="flex items-center gap-2 text-xs">
									<Badge variant="outline">상태</Badge>
									<span class="min-w-0 truncate" title={JSON.stringify(currentState.values)}>
										{assetName(model.assets, currentState.stateId) ?? currentState.stateName}
									</span>
									<Button
										variant="ghost"
										size="icon-sm"
										class="ml-auto"
										aria-label="상태 해제"
										disabled={busyKeys.has(`state:${device.id}`) ||
											model.session?.state === 'ended'}
										onclick={() => clearDeviceState(device.id)}
									>
										<XIcon />
									</Button>
								</div>
							{/if}
							{#if currentWebsite}
								<div class="flex items-center gap-2 text-xs">
									<Badge variant="outline">웹사이트</Badge>
									<span class="min-w-0 truncate" title={currentWebsite.url}>
										{assetName(model.assets, currentWebsite.websiteId) ?? currentWebsite.url}
									</span>
									<Button
										variant="ghost"
										size="icon-sm"
										class="ml-auto"
										aria-label="웹사이트 종료"
										disabled={busyKeys.has(`stop-site:${device.id}`) ||
											model.session?.state === 'ended'}
										onclick={() =>
											run(`stop-site:${device.id}`, () =>
												actions.runCommand({
													type: 'resetDevice',
													deviceId: device.id
												})
											)}
									>
										<XIcon />
									</Button>
								</div>
							{/if}
							{#each currentMedia as entry (entry.commandId)}
								<div class="flex items-center gap-2 text-xs">
									<Badge variant="outline">{channelLabels[entry.channel]}</Badge>
									<span class="min-w-0 truncate">
										{assetName(model.assets, entry.assetId) ?? entry.assetName}
									</span>
									<Button
										variant="ghost"
										size="icon-sm"
										class="ml-auto"
										aria-label="재생 정지"
										disabled={busyKeys.has(`stop:${entry.commandId}`) ||
											model.session?.state === 'ended'}
										onclick={() => run(`stop:${entry.commandId}`, () => stopMedia(entry))}
									>
										<XIcon />
									</Button>
								</div>
							{/each}
						</div>
					{/if}

					{#if expanded.has(device.id)}
						{@const form = formFor(device.id)}
						{@const stateForm = stateFormFor(device.id)}
						{@const registeredStates = status?.helperStates ?? []}
						{@const availableStates = statesFor(device.id)}
						{@const registeredMessages = status?.helperMessages ?? []}
						{@const callbacks = status?.helperTestCallbacks ?? []}
						{@const availableMessages = messagesFor(device.id)}
						<div class="flex flex-col gap-4 border-t px-3 py-3">
							<div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								{#if code}
									<span>접속 코드 <code class="text-foreground">{code}</code></span>
									<Button variant="outline" size="sm" onclick={() => copyCode(code)}>
										<CopyIcon data-icon="inline-start" />복사
									</Button>
								{/if}
								{#if status?.clientVersion}<span>Client {status.clientVersion}</span>{/if}
								{#if status?.helperVersion}<span>Helper {status.helperVersion}</span>{/if}
								<Button
									variant="outline"
									size="sm"
									class="ml-auto"
									disabled={busyKeys.has(`reset:${device.id}`) || model.session?.state === 'ended'}
									onclick={() =>
										run(`reset:${device.id}`, () =>
											actions.runCommand({
												type: 'resetDevice',
												deviceId: device.id
											})
										)}
								>
									<RotateCcwIcon data-icon="inline-start" />리셋
								</Button>
							</div>

							<Field.FieldGroup>
								<Field.Field>
									<Field.FieldLabel for="navigate-{device.id}">웹사이트 이동</Field.FieldLabel>
									<div class="flex items-center gap-2">
										<Select.Root type="single" bind:value={navigation[device.id]}>
											<Select.Trigger id="navigate-{device.id}" size="sm" class="flex-1">
												{websites.find((site) => site.id === navigation[device.id])?.name ??
													'웹사이트 선택'}
											</Select.Trigger>
											<Select.Content>
												<Select.Group>
													{#each websites as site (site.id)}
														<Select.Item value={site.id} label={site.name}>{site.name}</Select.Item>
													{/each}
												</Select.Group>
											</Select.Content>
										</Select.Root>
										<Button
											variant="outline"
											size="sm"
											disabled={!navigation[device.id]}
											onclick={() =>
												run(`navigate:${device.id}`, () =>
													actions.runCommand({
														type: 'navigate',
														deviceId: device.id,
														websiteId: navigation[device.id],
														query: []
													})
												)}
										>
											이동
										</Button>
									</div>
								</Field.Field>

								<Field.Field>
									<Field.FieldLabel for="message-{device.id}">Helper 메시지</Field.FieldLabel>
									<div class="flex flex-wrap items-center gap-2">
										<Select.Root type="single" bind:value={form.messageId}>
											<Select.Trigger id="message-{device.id}" size="sm" class="min-w-48 flex-1">
												{availableMessages.find((message) => message.id === form.messageId)?.data
													.displayName ||
													availableMessages.find((message) => message.id === form.messageId)
														?.name ||
													'메시지 선택'}
											</Select.Trigger>
											<Select.Content>
												<Select.Group>
													{#each availableMessages as message (message.id)}
														<Select.Item
															value={message.id}
															label={message.data.displayName || message.name}
														>
															{message.data.displayName ||
																message.name}{registeredMessages.includes(message.name) ? ' ✓' : ''}
														</Select.Item>
													{/each}
												</Select.Group>
											</Select.Content>
										</Select.Root>
										<Field.Field orientation="horizontal" class="w-auto">
											<Checkbox id="wait-{device.id}" bind:checked={form.wait} />
											<Field.FieldLabel for="wait-{device.id}">완료 대기</Field.FieldLabel>
										</Field.Field>
										<Button
											variant="outline"
											size="sm"
											disabled={!form.messageId || busyKeys.has(`message:${device.id}`)}
											onclick={() => sendMessage(device.id)}
										>
											전송
										</Button>
									</div>
									{#if form.messageId}
										{@const selectedMessage = availableMessages.find(
											(message) => message.id === form.messageId
										)}
										{#if selectedMessage}
											{@render valueInputs(
												form.values,
												selectedMessage.data.fields,
												`field-${device.id}`
											)}
										{/if}
									{/if}
									{#if registeredMessages.length > 0}
										<Field.FieldDescription>
											페이지 등록: {registeredMessages.join(', ')}
										</Field.FieldDescription>
									{/if}
								</Field.Field>

								<Field.Field>
									<Field.FieldLabel for="state-{device.id}">상태 설정</Field.FieldLabel>
									<div class="flex flex-wrap items-center gap-2">
										<Select.Root type="single" bind:value={stateForm.stateId}>
											<Select.Trigger id="state-{device.id}" size="sm" class="min-w-48 flex-1">
												{availableStates.find((state) => state.id === stateForm.stateId)?.data
													.displayName ||
													availableStates.find((state) => state.id === stateForm.stateId)?.name ||
													'상태 선택'}
											</Select.Trigger>
											<Select.Content>
												<Select.Group>
													{#each availableStates as state (state.id)}
														<Select.Item
															value={state.id}
															label={state.data.displayName || state.name}
														>
															{state.data.displayName || state.name}{registeredStates.includes(
																state.name
															)
																? ' ✓'
																: ''}
														</Select.Item>
													{/each}
												</Select.Group>
											</Select.Content>
										</Select.Root>
										<Button
											variant="outline"
											size="sm"
											disabled={!stateForm.stateId || busyKeys.has(`state:${device.id}`)}
											onclick={() => setDeviceState(device.id)}
										>
											설정
										</Button>
										<Button
											variant="ghost"
											size="sm"
											disabled={!currentState || busyKeys.has(`state:${device.id}`)}
											onclick={() => clearDeviceState(device.id)}
										>
											해제
										</Button>
									</div>
									{#if stateForm.stateId}
										{@const selectedState = availableStates.find(
											(state) => state.id === stateForm.stateId
										)}
										{#if selectedState}
											{@render valueInputs(
												stateForm.values,
												selectedState.data.fields,
												`state-field-${device.id}`
											)}
										{/if}
									{/if}
									<Field.FieldDescription>
										{#if registeredStates.length > 0}
											페이지 등록: {registeredStates.join(', ')} ·
										{/if}
										상태는 장치가 다시 접속해도 유지됩니다. 일시적인 효과에는 메시지를 쓰세요.
									</Field.FieldDescription>
								</Field.Field>
							</Field.FieldGroup>

							{#if callbacks.length > 0}
								<div class="flex flex-col gap-1.5">
									<p class="text-xs font-medium text-muted-foreground">테스트 콜백</p>
									<div class="flex flex-wrap gap-1.5">
										{#each callbacks as name (name)}
											{@const result = callbackResults[`${device.id}:${name}`]}
											<Button
												variant="outline"
												size="sm"
												disabled={result === 'running'}
												onclick={() => callback(device.id, name)}
											>
												{name}{result === 'ok' ? ' ✓' : result === 'fail' ? ' ✕' : ''}
											</Button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
{/if}
