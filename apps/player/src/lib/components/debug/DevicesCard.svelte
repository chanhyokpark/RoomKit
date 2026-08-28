<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import type { Asset, JsonValue, SessionResponse } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import { api, ApiError } from '../../api';
	import { admin } from '../../stores/admin.svelte';
	import { themeAssets } from '../../stores/theme-assets.svelte';

	let {
		sessionId,
		sessionInfo
	}: { sessionId: string; sessionInfo: SessionResponse | null } = $props();

	type MessageAsset = Extract<Asset, { kind: 'message' }>;
	type DeviceAsset = Extract<Asset, { kind: 'device' }>;

	let error = $state('');
	let expanded = $state<Record<string, boolean>>({});
	/** Per-device message form: selected message id + field values (as text). */
	let messageForm = $state<
		Record<string, { messageId: string; values: Record<string, string>; wait: boolean }>
	>({});
	/** Per-device navigate form. */
	let navigateForm = $state<Record<string, string>>({});
	let callbackResult = $state<Record<string, 'ok' | 'fail' | 'running'>>({});

	/** Devices of this session: the ones codes were minted for (fallback: all). */
	const devices = $derived.by(() => {
		const all = themeAssets.devices as DeviceAsset[];
		const codes = sessionInfo?.testDeviceCodes;
		if (!codes || codes.length === 0) return all;
		const ids = new Set(codes.map((c) => c.deviceId));
		return all.filter((d) => ids.has(d.id));
	});

	function codeOf(deviceId: string): string | null {
		return sessionInfo?.testDeviceCodes?.find((c) => c.deviceId === deviceId)?.code ?? null;
	}

	function statusOf(deviceId: string) {
		return admin.deviceStatus[deviceId] ?? null;
	}

	function websiteOf(deviceId: string): string | null {
		return admin.media?.websites.find((w) => w.deviceId === deviceId)?.url ?? null;
	}

	/** Message assets the loaded page registered by name (fallback: all). */
	function messagesFor(deviceId: string): MessageAsset[] {
		const all = themeAssets.messages as MessageAsset[];
		const registered = statusOf(deviceId)?.helperMessages;
		if (!registered || registered.length === 0) return all;
		return all.filter((m) => registered.includes(m.name));
	}

	function formFor(deviceId: string) {
		if (!messageForm[deviceId]) {
			messageForm[deviceId] = { messageId: '', values: {}, wait: false };
		}
		return messageForm[deviceId];
	}

	async function command(body: unknown) {
		error = '';
		try {
			await api(`/sessions/${sessionId}/command`, { method: 'POST', body });
		} catch (err) {
			error = err instanceof ApiError ? err.message : '커맨드를 실행하지 못했습니다.';
		}
	}

	function sendMessage(deviceId: string) {
		const form = formFor(deviceId);
		const message = (themeAssets.messages as MessageAsset[]).find(
			(m) => m.id === form.messageId
		);
		if (!message) return;
		const values: Record<string, JsonValue> = {};
		for (const field of message.data.fields) {
			const raw = form.values[field.key] ?? '';
			if (raw === '' && !field.required) continue;
			try {
				values[field.key] =
					field.type === 'number'
						? Number(raw)
						: field.type === 'boolean'
							? raw === 'true'
							: field.type === 'json'
								? (JSON.parse(raw || 'null') as JsonValue)
								: raw;
			} catch {
				error = `필드 "${field.label || field.key}"의 JSON이 올바르지 않습니다.`;
				return;
			}
		}
		void command({
			type: 'sendMessage',
			deviceId,
			messageId: message.id,
			values,
			waitUntilEnd: form.wait
		});
	}

	async function runCallback(deviceId: string, name: string) {
		const key = `${deviceId}:${name}`;
		callbackResult[key] = 'running';
		try {
			const result = await api<{ ok: boolean }>(
				`/sessions/${sessionId}/devices/${deviceId}/test-callback`,
				{ method: 'POST', body: { name } }
			);
			callbackResult[key] = result.ok ? 'ok' : 'fail';
		} catch {
			callbackResult[key] = 'fail';
		}
	}

	async function copyCode(code: string) {
		try {
			await navigator.clipboard.writeText(code);
		} catch {
			// Clipboard may be unavailable in the webview; the code is still visible.
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>디바이스</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-2.5">
		{#each devices as device (device.id)}
			{@const status = statusOf(device.id)}
			{@const website = websiteOf(device.id)}
			{@const code = codeOf(device.id)}
			<div class="rounded-md border bg-card">
				<button
					class="flex w-full items-center gap-2 px-3 py-2 text-left"
					onclick={() => (expanded[device.id] = !expanded[device.id])}
				>
					<span
						class="h-2 w-2 rounded-full {status?.online ? 'bg-emerald-400' : 'bg-muted'}"
					></span>
					<span class="text-sm">{device.data.displayName || device.name}</span>
					{#if code}
						<span class="font-mono text-xs text-muted-foreground">{code}</span>
					{/if}
					{#if website}
						<span class="max-w-48 truncate text-xs text-muted-foreground">{website}</span>
					{/if}
					{#if expanded[device.id]}
						<ChevronDownIcon class="ml-auto size-4 text-muted-foreground" />
					{:else}
						<ChevronRightIcon class="ml-auto size-4 text-muted-foreground" />
					{/if}
				</button>

				{#if expanded[device.id]}
					{@const form = formFor(device.id)}
					{@const registeredCallbacks = status?.helperTestCallbacks ?? []}
					{@const messages = messagesFor(device.id)}
					<div class="flex flex-col gap-3 border-t px-3 py-2.5">
						{#if code}
							<div class="flex items-center gap-2 text-xs text-muted-foreground">
								접속 코드 <span class="font-mono text-foreground">{code}</span>
								<Button variant="outline" size="sm" onclick={() => void copyCode(code)}>
									복사
								</Button>
								<Button
									variant="outline"
									size="sm"
									class="ml-auto"
									onclick={() => void command({ type: 'resetDevice', deviceId: device.id })}
								>
									리셋
								</Button>
							</div>
						{/if}

						<!-- 내비게이션 -->
						<div class="flex items-center gap-2">
							<span class="w-16 shrink-0 text-xs text-muted-foreground">이동</span>
							<Select.Root type="single" bind:value={navigateForm[device.id]}>
								<Select.Trigger size="sm" class="flex-1">
									{themeAssets.websites.find((w) => w.id === navigateForm[device.id])?.name ??
										'웹사이트 선택'}
								</Select.Trigger>
								<Select.Content>
									{#each themeAssets.websites as site (site.id)}
										<Select.Item value={site.id} label={site.name}>{site.name}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							<Button
								variant="outline"
								size="sm"
								disabled={!navigateForm[device.id]}
								onclick={() =>
									void command({
										type: 'navigate',
										deviceId: device.id,
										websiteId: navigateForm[device.id],
										query: []
									})}
							>
								이동
							</Button>
						</div>

						<!-- 등록된 메시지 전송 -->
						<div class="flex flex-col gap-1.5">
							<div class="flex items-center gap-2">
								<span class="w-16 shrink-0 text-xs text-muted-foreground">메시지</span>
								<Select.Root type="single" bind:value={form.messageId}>
									<Select.Trigger size="sm" class="flex-1">
										{messages.find((m) => m.id === form.messageId)?.data.displayName ||
											messages.find((m) => m.id === form.messageId)?.name ||
											'메시지 선택'}
									</Select.Trigger>
									<Select.Content>
										{#each messages as message (message.id)}
											<Select.Item
												value={message.id}
												label={message.data.displayName || message.name}
											>
												{message.data.displayName || message.name}
												{status?.helperMessages?.includes(message.name) ? ' ✓' : ''}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<div class="flex items-center gap-1">
									<Checkbox id="wait-{device.id}" bind:checked={form.wait} />
									<Label
										for="wait-{device.id}"
										class="text-xs font-normal text-muted-foreground"
									>
										대기
									</Label>
								</div>
								<Button
									variant="outline"
									size="sm"
									disabled={!form.messageId}
									onclick={() => sendMessage(device.id)}
								>
									전송
								</Button>
							</div>
							{#if status?.helperMessages && status.helperMessages.length > 0}
								<p class="pl-18 text-[11px] text-muted-foreground">
									페이지 등록 메시지: {status.helperMessages.join(', ')}
								</p>
							{/if}
							{#if form.messageId}
								{@const selected = messages.find((m) => m.id === form.messageId)}
								{#if selected}
									{#each selected.data.fields as field (field.key)}
										<div class="flex items-center gap-2 pl-18">
											<span class="w-24 shrink-0 truncate text-[11px] text-muted-foreground">
												{field.label || field.key}{field.required ? ' *' : ''}
											</span>
											{#if field.type === 'boolean'}
												<Select.Root type="single" bind:value={form.values[field.key]}>
													<Select.Trigger size="sm" class="w-24">
														{form.values[field.key] || '-'}
													</Select.Trigger>
													<Select.Content>
														<Select.Item value="" label="-">-</Select.Item>
														<Select.Item value="true" label="true">true</Select.Item>
														<Select.Item value="false" label="false">false</Select.Item>
													</Select.Content>
												</Select.Root>
											{:else}
												<Input
													class="h-8 flex-1 font-mono text-xs"
													placeholder={field.type}
													bind:value={form.values[field.key]}
												/>
											{/if}
										</div>
									{/each}
								{/if}
							{/if}
						</div>

						<!-- 테스트 콜백 -->
						{#if registeredCallbacks.length > 0}
							<div class="flex flex-wrap items-center gap-1.5">
								<span class="w-16 shrink-0 text-xs text-muted-foreground">콜백</span>
								{#each registeredCallbacks as name (name)}
									{@const result = callbackResult[`${device.id}:${name}`]}
									<Button
										variant="outline"
										size="sm"
										disabled={result === 'running'}
										onclick={() => void runCallback(device.id, name)}
									>
										{name}
										{result === 'ok' ? '✓' : result === 'fail' ? '✕' : ''}
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		{#if error}
			<p class="text-xs text-destructive">{error}</p>
		{/if}
	</Card.Content>
</Card.Root>
