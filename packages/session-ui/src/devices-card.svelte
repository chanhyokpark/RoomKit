<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import PhoneOffIcon from '@lucide/svelte/icons/phone-off';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RouterIcon from '@lucide/svelte/icons/router';
	import SquareIcon from '@lucide/svelte/icons/square';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { Command, JsonValue, MessageField, PlayChannel, PlayingMedia } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils';
	import { assetName, assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';
	import type { MessageAsset, StateAsset } from './types.js';

	const { model, actions } = useSessionUi();
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
	/** Device whose screenshot is shown enlarged; the image keeps updating live. */
	let enlargedDeviceId = $state<string | null>(null);
	let now = $state(Date.now());

	// Players report every few seconds; the "n초 전" labels tick alongside.
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	/** A capture older than this is likely from a stalled or paused player. */
	const STALE_AFTER_MS = 20_000;

	function ago(capturedAt: number): string {
		const seconds = Math.max(0, Math.round((now - capturedAt) / 1000));
		if (seconds < 60) return `${seconds}초 전`;
		return `${Math.floor(seconds / 60)}분 전`;
	}

	function deviceName(deviceId: string): string {
		const device = allDevices.find((candidate) => candidate.id === deviceId);
		return device ? device.data.displayName || device.name : deviceId;
	}

	const enlarged = $derived(enlargedDeviceId ? model.screenshotOf(enlargedDeviceId) : null);

	// Voice calls: hosts without call support (player debug window) and test
	// sessions show no call controls at all.
	const callsEnabled = $derived(
		!!actions.startCall &&
			model.session?.mode === 'production' &&
			model.session.state !== 'ended'
	);
	const activeCall = $derived(model.call ?? null);
	const callStatusLabels = { requested: '통화 요청', connecting: '연결 중', connected: '통화 중' };

	function canCall(deviceId: string): boolean {
		const status = model.statusOf(deviceId);
		return !!status?.online && status.helperVersion !== undefined && !activeCall;
	}

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

	function formFor(deviceId: string): MessageForm {
		if (!messageForms[deviceId]) {
			messageForms[deviceId] = { messageId: '', values: {}, wait: false };
		}
		return messageForms[deviceId];
	}

	function messagesFor(deviceId: string): MessageAsset[] {
		const registered = model.statusOf(deviceId)?.helperMessages;
		if (!registered || registered.length === 0) return messages;
		return messages.filter((message) => registered.includes(message.name));
	}

	function stateFormFor(deviceId: string): StateForm {
		if (!stateForms[deviceId]) stateForms[deviceId] = { stateId: '', values: {} };
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
					<Input id="{prefix}-{field.key}" placeholder={field.type} bind:value={values[field.key]} />
				{/if}
			</Field.Field>
		{/each}
	</Field.FieldGroup>
{/snippet}

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
			{@const screenshot = model.screenshotOf(device.id)}
			<div class="rounded-md border">
				<button
					type="button"
					class="flex w-full items-center gap-2 px-3 py-2 text-left"
					onclick={() =>
						expanded.has(device.id) ? expanded.delete(device.id) : expanded.add(device.id)}
				>
					<span class={cn('size-2 rounded-full', status?.online ? 'bg-primary' : 'bg-muted')}
					></span>
					<span class="truncate text-sm font-medium">{device.data.displayName || device.name}</span>
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

				{#if screenshot}
					{@const stale = now - screenshot.capturedAt > STALE_AFTER_MS}
					<div class="border-t px-3 py-2">
						<button
							type="button"
							class="relative block w-full overflow-hidden rounded-md bg-black ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
							aria-label="{device.data.displayName || device.name} 화면 확대"
							onclick={() => (enlargedDeviceId = device.id)}
						>
							<img
								src={screenshot.image}
								alt="{device.data.displayName || device.name} 화면"
								width={screenshot.width}
								height={screenshot.height}
								class={cn('mx-auto max-h-44 w-auto object-contain', stale && 'opacity-50')}
							/>
							<span
								class={cn(
									'absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white',
									stale && 'bg-amber-600/80'
								)}
							>
								{ago(screenshot.capturedAt)}
							</span>
						</button>
					</div>
				{/if}

				{#if callsEnabled}
					<div class="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
						{#if activeCall?.deviceId === device.id}
							<Badge variant={activeCall.status === 'connected' ? 'default' : 'secondary'}>
								{callStatusLabels[activeCall.status]}
							</Badge>
							{#if activeCall.status === 'requested'}
								<Button
									size="sm"
									class="ml-auto"
									disabled={busyKeys.has(`call:${device.id}`) || !actions.acceptCall}
									onclick={() => {
										const callId = activeCall.callId;
										void run(`call:${device.id}`, () => actions.acceptCall!(callId));
									}}
								>
									<PhoneIcon data-icon="inline-start" />수락
								</Button>
								<Button
									size="sm"
									variant="outline"
									disabled={busyKeys.has(`call:${device.id}`) || !actions.declineCall}
									onclick={() => {
										const callId = activeCall.callId;
										void run(`call:${device.id}`, () => actions.declineCall!(callId));
									}}
								>
									<PhoneOffIcon data-icon="inline-start" />거절
								</Button>
							{:else if model.ownsCall}
								<Button
									size="sm"
									variant="destructive"
									class="ml-auto"
									disabled={busyKeys.has(`call:${device.id}`) || !actions.endCall}
									onclick={() => run(`call:${device.id}`, () => actions.endCall!())}
								>
									<PhoneOffIcon data-icon="inline-start" />종료
								</Button>
							{:else}
								<span class="ml-auto text-muted-foreground">다른 운영자가 통화 중</span>
							{/if}
						{:else}
							<span class="text-muted-foreground">
								{status?.helperVersion === undefined
									? 'Helper 웹사이트에서만 통화할 수 있습니다.'
									: '음성 통화'}
							</span>
							<Button
								size="sm"
								variant="outline"
								class="ml-auto"
								disabled={!canCall(device.id) || busyKeys.has(`call:${device.id}`)}
								onclick={() => run(`call:${device.id}`, () => actions.startCall!(device.id))}
							>
								<PhoneIcon data-icon="inline-start" />통화
							</Button>
						{/if}
					</div>
				{/if}

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
									disabled={busyKeys.has(`state:${device.id}`) || model.session?.state === 'ended'}
									onclick={() => clearDeviceState(device.id)}
								>
									<SquareIcon />
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
									<SquareIcon />
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
									<SquareIcon />
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
												availableMessages.find((message) => message.id === form.messageId)?.name ||
												'메시지 선택'}
										</Select.Trigger>
										<Select.Content>
											<Select.Group>
												{#each availableMessages as message (message.id)}
													<Select.Item
														value={message.id}
														label={message.data.displayName || message.name}
													>
														{message.data.displayName || message.name}{registeredMessages.includes(
															message.name
														)
															? ' ✓'
															: ''}
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
													<Select.Item value={state.id} label={state.data.displayName || state.name}>
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

<Dialog.Root
	open={enlargedDeviceId !== null}
	onOpenChange={(open) => {
		if (!open) enlargedDeviceId = null;
	}}
>
	<Dialog.Content class="sm:max-w-5xl">
		<Dialog.Header>
			<Dialog.Title>{enlargedDeviceId ? deviceName(enlargedDeviceId) : ''} 화면</Dialog.Title>
			<Dialog.Description>
				{#if enlarged}
					{enlarged.width}×{enlarged.height} · {ago(enlarged.capturedAt)} 캡처 · 자동 갱신
				{:else}
					캡처된 화면이 없습니다.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if enlarged}
			<img
				src={enlarged.image}
				alt="{enlargedDeviceId ? deviceName(enlargedDeviceId) : ''} 화면"
				width={enlarged.width}
				height={enlarged.height}
				class="max-h-[75vh] w-full rounded-md bg-black object-contain"
			/>
		{/if}
	</Dialog.Content>
</Dialog.Root>
