<script lang="ts">
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import RouterIcon from '@lucide/svelte/icons/router';
	import XIcon from '@lucide/svelte/icons/x';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { Command, PlayChannel, PlayingMedia } from '@roomkit/shared';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { cn } from '$lib/utils';
	import { assetName, assetsOf } from './assets.js';
	import { useSessionUi } from './context.js';
	import { channelLabels, formatClock, formatDuration, stripHtml } from './format.js';
	import InjectDialog from './inject-dialog.svelte';

	const { model, actions, view } = useSessionUi();
	const busyKeys = new SvelteSet<string>();
	/** Active rows (state / website / playing media) whose details are unfolded. */
	const unfolded = new SvelteSet<string>();
	let callbackResults = $state<Record<string, 'running' | 'ok' | 'fail'>>({});
	/** Device whose "+" (asset inject) dialog is open. */
	let injectDeviceId = $state<string | null>(null);
	let now = $state(Date.now());

	const allDevices = $derived(assetsOf(model.assets, 'device'));
	const codeDeviceIds = $derived(new Set(model.testDeviceCodes.map((entry) => entry.deviceId)));
	const devices = $derived(
		codeDeviceIds.size > 0
			? allDevices.filter((device) => codeDeviceIds.has(device.id))
			: allDevices
	);
	const injectDevice = $derived(
		injectDeviceId ? (devices.find((device) => device.id === injectDeviceId) ?? null) : null
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
	const ended = $derived(model.session?.state === 'ended');

	// Elapsed times only tick while some detail block is showing them.
	$effect(() => {
		if (unfolded.size === 0) return;
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	const stopTypes: Record<PlayChannel, Command['type']> = {
		bgm: 'stopBgm',
		sfx: 'stopSfx',
		dialogue: 'stopDialogue',
		video: 'stopVideo'
	};

	function toggleUnfolded(key: string): void {
		if (unfolded.has(key)) unfolded.delete(key);
		else unfolded.add(key);
	}

	function dialogueOf(entry: PlayingMedia) {
		const asset = model.assets.find((candidate) => candidate.id === entry.assetId);
		return asset?.kind === 'dialogue' ? asset : null;
	}

	/** Known total length: placeholder media (simulated) or a fully placeholder dialogue. */
	function durationOf(entry: PlayingMedia): number | null {
		const asset = model.assets.find((candidate) => candidate.id === entry.assetId);
		if (!asset) return null;
		switch (asset.kind) {
			case 'bgm':
			case 'sfx':
			case 'video':
				return asset.data.fileKey === null ? asset.data.durationMs : null;
			case 'dialogue':
				return asset.data.lines.every((line) => line.fileKey === null)
					? asset.data.lines.reduce((sum, line) => sum + line.durationMs, 0)
					: null;
			default:
				return null;
		}
	}

	function playtime(entry: PlayingMedia): string {
		const elapsed = now - entry.startedAt;
		const total = durationOf(entry);
		if (entry.loop && total !== null) {
			return `${formatDuration(elapsed % total)} / ${formatDuration(total)} (${Math.floor(elapsed / total) + 1}회차)`;
		}
		return total !== null
			? `${formatDuration(Math.min(elapsed, total))} / ${formatDuration(total)}`
			: formatDuration(elapsed);
	}

	function formatValue(value: unknown): string {
		return typeof value === 'string' ? value : JSON.stringify(value);
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

	function clearDeviceState(deviceId: string): void {
		void run(`state:${deviceId}`, () =>
			actions.runCommand({ type: 'clearState', deviceId, allDevices: false })
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

{#snippet foldToggle(key: string, label: string)}
	<button
		type="button"
		class="flex min-w-0 flex-1 items-center gap-2 text-left"
		aria-expanded={unfolded.has(key)}
		onclick={() => toggleUnfolded(key)}
	>
		{#if unfolded.has(key)}
			<ChevronDownIcon class="size-3 shrink-0 text-muted-foreground" />
		{:else}
			<ChevronRightIcon class="size-3 shrink-0 text-muted-foreground" />
		{/if}
		<span class="min-w-0 truncate">{label}</span>
	</button>
{/snippet}

{#snippet detail(label: string, value: string)}
	<dt class="text-muted-foreground">{label}</dt>
	<dd class="min-w-0 break-all">{value}</dd>
{/snippet}

{#if view.simple}
	<!-- Simple mode: connection state only; nothing to expand or operate. -->
	<Card.Root>
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
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2"><RouterIcon />디바이스</Card.Title>
			<Card.Description>
				연결과 현재 재생 항목을 확인하고, + 버튼으로 애셋을 주입합니다.
			</Card.Description>
			<Card.Action>
				<Button
					size="sm"
					variant="outline"
					disabled={busyKeys.has('reset-all') || ended}
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
				{@const callbacks = status?.helperTestCallbacks ?? []}
				<div class="rounded-md border">
					<div class="flex items-center gap-2 px-3 py-2">
						<span class={cn('size-2 rounded-full', status?.online ? 'bg-primary' : 'bg-muted')}
						></span>
						<span class="truncate text-sm font-medium"
							>{device.data.displayName || device.name}</span
						>
						{#if device.data.isHintDevice}<Badge variant="secondary">힌트</Badge>{/if}
						<Badge variant={status?.online ? 'outline' : 'secondary'} class="ml-auto">
							{status?.online ? '온라인' : '오프라인'}
						</Badge>
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="디바이스 리셋"
							title="디바이스 리셋"
							disabled={busyKeys.has(`reset:${device.id}`) || ended}
							onclick={() =>
								run(`reset:${device.id}`, () =>
									actions.runCommand({ type: 'resetDevice', deviceId: device.id })
								)}
						>
							<RotateCcwIcon />
						</Button>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label="애셋 주입"
							title="애셋 주입"
							disabled={ended}
							onclick={() => (injectDeviceId = device.id)}
						>
							<PlusIcon />
						</Button>
					</div>

					{#if code || status?.clientVersion || status?.helperVersion}
						<div
							class="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs text-muted-foreground"
						>
							{#if code}
								<span class="flex items-center gap-1">
									접속 코드 <code class="text-foreground">{code}</code>
									<Button
										variant="ghost"
										size="icon-xs"
										aria-label="코드 복사"
										onclick={() => copyCode(code)}
									>
										<CopyIcon />
									</Button>
								</span>
							{/if}
							{#if status?.clientVersion}<span>Client {status.clientVersion}</span>{/if}
							{#if status?.helperVersion}<span>Helper {status.helperVersion}</span>{/if}
						</div>
					{/if}

					{#if currentWebsite || currentState || currentMedia.length > 0}
						<div class="flex flex-col gap-1.5 border-t px-3 py-2">
							{#if currentState}
								{@const key = `state:${device.id}`}
								<div class="flex items-center gap-2 text-xs">
									<Badge variant="outline">상태</Badge>
									{@render foldToggle(
										key,
										assetName(model.assets, currentState.stateId) ?? currentState.stateName
									)}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="상태 해제"
										disabled={busyKeys.has(`state:${device.id}`) || ended}
										onclick={() => clearDeviceState(device.id)}
									>
										<XIcon />
									</Button>
								</div>
								{#if unfolded.has(key)}
									{@const entries = Object.entries(currentState.values)}
									<dl
										class="ml-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs"
									>
										{@render detail('설정 시각', formatClock(currentState.startedAt))}
										{@render detail('경과', formatDuration(now - currentState.startedAt))}
										{#if entries.length === 0}
											{@render detail('값', '없음')}
										{/if}
										{#each entries as [field, value] (field)}
											{@render detail(field, formatValue(value))}
										{/each}
									</dl>
								{/if}
							{/if}
							{#if currentWebsite}
								{@const key = `site:${device.id}`}
								<div class="flex items-center gap-2 text-xs">
									<Badge variant="outline">웹사이트</Badge>
									{@render foldToggle(
										key,
										assetName(model.assets, currentWebsite.websiteId) ?? currentWebsite.url
									)}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="웹사이트 종료"
										disabled={busyKeys.has(`stop-site:${device.id}`) || ended}
										onclick={() =>
											run(`stop-site:${device.id}`, () =>
												actions.runCommand({ type: 'resetDevice', deviceId: device.id })
											)}
									>
										<XIcon />
									</Button>
								</div>
								{#if unfolded.has(key)}
									<dl
										class="ml-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs"
									>
										{@render detail('URL', currentWebsite.url)}
										{@render detail('이동 시각', formatClock(currentWebsite.startedAt))}
										{@render detail('경과', formatDuration(now - currentWebsite.startedAt))}
										{#if status?.helperMessages?.length}
											{@render detail('등록 메시지', status.helperMessages.join(', '))}
										{/if}
										{#if status?.helperStates?.length}
											{@render detail('등록 상태', status.helperStates.join(', '))}
										{/if}
									</dl>
								{/if}
							{/if}
							{#each currentMedia as entry (entry.commandId)}
								{@const key = `media:${entry.commandId}`}
								{@const dialogue = entry.channel === 'dialogue' ? dialogueOf(entry) : null}
								<div class="flex items-center gap-2 text-xs">
									<Badge variant="outline">{channelLabels[entry.channel]}</Badge>
									{@render foldToggle(
										key,
										assetName(model.assets, entry.assetId) ?? entry.assetName
									)}
									{#if entry.loop}<Badge variant="secondary">반복</Badge>{/if}
									{#if entry.channel === 'dialogue' && dialogue && entry.lineIndex !== null}
										<span class="shrink-0 text-muted-foreground">
											{entry.lineIndex + 1}/{dialogue.data.lines.length}
										</span>
									{/if}
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label="재생 정지"
										disabled={busyKeys.has(`stop:${entry.commandId}`) || ended}
										onclick={() => run(`stop:${entry.commandId}`, () => stopMedia(entry))}
									>
										<XIcon />
									</Button>
								</div>
								{#if unfolded.has(key)}
									<dl
										class="ml-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs"
									>
										{@render detail('재생 시간', playtime(entry))}
										{@render detail('시작 시각', formatClock(entry.startedAt))}
										{@render detail(
											'플레이어',
											assetName(model.assets, entry.playerId) ?? '(삭제됨)'
										)}
										{#if entry.channel === 'bgm'}
											{@render detail('반복', entry.loop ? '켜짐' : '꺼짐')}
										{/if}
										{#if entry.channel === 'dialogue'}
											{@render detail(
												'현재 라인',
												dialogue
													? entry.lineIndex === null
														? `시작 대기 (${dialogue.data.lines.length}줄)`
														: `${entry.lineIndex + 1} / ${dialogue.data.lines.length}`
													: entry.lineIndex === null
														? '시작 대기'
														: String(entry.lineIndex + 1)
											)}
											{#if dialogue && dialogue.data.lines.length > 0}
												<ol
													class="col-span-2 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded border bg-background p-1.5"
												>
													{#each dialogue.data.lines as line, index (line.id)}
														{@const active = index === entry.lineIndex}
														<li
															class={cn(
																'flex items-center gap-2 rounded px-1.5 py-0.5',
																active ? 'bg-muted font-medium' : 'text-muted-foreground'
															)}
														>
															<span class="w-5 shrink-0 text-right font-mono">{index + 1}</span>
															<span class="min-w-0 truncate">
																{stripHtml(line.subtitleHtml) || '(자막 없음)'}
															</span>
															{#if active}<Badge variant="outline" class="ml-auto">재생 중</Badge
																>{/if}
														</li>
													{/each}
												</ol>
											{/if}
										{/if}
										{@render detail('명령 ID', entry.commandId)}
									</dl>
								{/if}
							{/each}
						</div>
					{/if}

					{#if callbacks.length > 0}
						<div class="flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
							<span class="mr-1 text-xs font-medium text-muted-foreground">테스트 콜백</span>
							{#each callbacks as name (name)}
								{@const result = callbackResults[`${device.id}:${name}`]}
								<Button
									variant="outline"
									size="xs"
									disabled={result === 'running'}
									onclick={() => callback(device.id, name)}
								>
									{name}{result === 'ok' ? ' ✓' : result === 'fail' ? ' ✕' : ''}
								</Button>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</Card.Content>
	</Card.Root>

	{#if injectDevice}
		<InjectDialog
			device={injectDevice}
			bind:open={
				() => injectDeviceId !== null,
				(value) => {
					if (!value) injectDeviceId = null;
				}
			}
		/>
	{/if}
{/if}
