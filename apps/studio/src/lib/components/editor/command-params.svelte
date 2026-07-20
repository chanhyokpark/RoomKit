<script lang="ts">
	import type { SequenceEntry } from '@roomkit/shared';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import AssetSelect from './asset-select.svelte';
	import MessageValuesFields from './message-values-fields.svelte';

	let {
		entry,
		ownEventId,
		onchanged
	}: {
		entry: SequenceEntry;
		/** The event being edited — excluded from callEvent targets. */
		ownEventId: string;
		onchanged: () => void;
	} = $props();

	const TIMER_VARIANT_LABELS = {
		delta: '시간 조정',
		pause: '일시정지',
		resume: '재개'
	} as const;
	type TimerVariant = keyof typeof TIMER_VARIANT_LABELS;

	function parseMs(text: string, fallback: number, min?: number): number {
		const num = Math.round(Number(text));
		if (!Number.isFinite(num)) return fallback;
		return min !== undefined ? Math.max(min, num) : num;
	}

	function secondsHint(ms: number): string {
		return `≈ ${(ms / 1000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
	}
</script>

<div class="mt-2 flex flex-wrap items-end gap-x-3 gap-y-2">
	{#if entry.type === 'resetDevice'}
		<AssetSelect kind="device" label="장치" bind:id={entry.deviceId} {onchanged} />
	{:else if entry.type === 'resetAllDevices'}
		<p class="text-xs text-muted-foreground">테마의 모든 장치에 리셋 명령을 보냅니다.</p>
	{:else if entry.type === 'playDialogue'}
		<AssetSelect kind="dialogue" label="대사" bind:id={entry.dialogueId} {onchanged} />
		<AssetSelect kind="player" label="플레이어" bind:id={entry.playerId} {onchanged} />
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.waitUntilEnd}
				onCheckedChange={(checked) => {
					if (entry.type === 'playDialogue') entry.waitUntilEnd = checked;
					onchanged();
				}}
			/>
			끝날 때까지 대기
		</label>
	{:else if entry.type === 'playSfx'}
		<AssetSelect kind="sfx" label="효과음" bind:id={entry.sfxId} {onchanged} />
		<AssetSelect kind="player" label="플레이어" bind:id={entry.playerId} {onchanged} />
	{:else if entry.type === 'playVideo'}
		<AssetSelect kind="video" label="비디오" bind:id={entry.videoId} {onchanged} />
		<AssetSelect kind="player" label="플레이어" bind:id={entry.playerId} {onchanged} />
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.waitUntilEnd}
				onCheckedChange={(checked) => {
					if (entry.type === 'playVideo') entry.waitUntilEnd = checked;
					onchanged();
				}}
			/>
			끝날 때까지 대기
		</label>
	{:else if entry.type === 'playBgm'}
		<AssetSelect kind="bgm" label="BGM" bind:id={entry.bgmId} {onchanged} />
		<AssetSelect kind="player" label="플레이어" bind:id={entry.playerId} {onchanged} />
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.loop}
				onCheckedChange={(checked) => {
					if (entry.type === 'playBgm') entry.loop = checked;
					onchanged();
				}}
			/>
			반복 재생
		</label>
	{:else if entry.type === 'stopDialogue' || entry.type === 'stopSfx' || entry.type === 'stopVideo' || entry.type === 'stopBgm'}
		<AssetSelect kind="player" label="플레이어" bind:id={entry.playerId} {onchanged} />
	{:else if entry.type === 'wait'}
		<div class="flex items-center gap-2">
			<Input
				class="h-8 w-32"
				type="number"
				min="1"
				step="100"
				value={entry.durationMs}
				aria-label="대기 시간 (ms)"
				onchange={(changeEvent) => {
					if (entry.type === 'wait')
						entry.durationMs = parseMs(changeEvent.currentTarget.value, entry.durationMs, 1);
					onchanged();
				}}
			/>
			<span class="text-xs text-muted-foreground">ms · {secondsHint(entry.durationMs)}</span>
		</div>
	{:else if entry.type === 'navigate'}
		<AssetSelect kind="device" label="장치" bind:id={entry.deviceId} {onchanged} />
		<AssetSelect kind="website" label="웹사이트" bind:id={entry.websiteId} {onchanged} />
	{:else if entry.type === 'sendMessage'}
		<AssetSelect kind="device" label="장치" bind:id={entry.deviceId} {onchanged} />
		<AssetSelect kind="message" label="메시지" bind:id={entry.messageId} {onchanged} />
		<div class="w-full">
			<MessageValuesFields messageId={entry.messageId} values={entry.values} {onchanged} />
		</div>
	{:else if entry.type === 'switchPhase'}
		<AssetSelect kind="phase" label="페이즈" bind:id={entry.phaseId} {onchanged} />
	{:else if entry.type === 'callEvent'}
		<AssetSelect
			kind="event"
			label="이벤트"
			excludeId={ownEventId}
			bind:id={entry.eventId}
			{onchanged}
		/>
	{:else if entry.type === 'adjustTimer'}
		{@const variant = (
			'deltaMs' in entry.adjustment ? 'delta' : entry.adjustment.action
		) as TimerVariant}
		<div class="flex min-w-36 flex-col gap-1">
			<span class="text-xs text-muted-foreground">동작</span>
			<Select.Root
				type="single"
				value={variant}
				onValueChange={(value) => {
					if (entry.type !== 'adjustTimer') return;
					entry.adjustment =
						value === 'delta' ? { deltaMs: 60_000 } : { action: value as 'pause' | 'resume' };
					onchanged();
				}}
			>
				<Select.Trigger size="sm" class="w-full" aria-label="타이머 동작">
					{TIMER_VARIANT_LABELS[variant]}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each Object.entries(TIMER_VARIANT_LABELS) as [value, label] (value)}
							<Select.Item {value} {label}>{label}</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</div>
		{#if 'deltaMs' in entry.adjustment}
			{@const adjustment = entry.adjustment}
			<div class="flex items-center gap-2">
				<Input
					class="h-8 w-36"
					type="number"
					step="1000"
					value={adjustment.deltaMs}
					aria-label="조정량 (ms)"
					onchange={(changeEvent) => {
						adjustment.deltaMs = parseMs(changeEvent.currentTarget.value, adjustment.deltaMs);
						onchanged();
					}}
				/>
				<span class="text-xs text-muted-foreground">
					ms · {secondsHint(adjustment.deltaMs)} (양수 = 시간 추가)
				</span>
			</div>
		{/if}
	{:else if entry.type === 'eval'}
		<div class="flex w-full flex-col gap-1">
			<Textarea
				class="min-h-24 font-mono text-xs"
				rows={4}
				placeholder="// 서버 샌드박스에서 실행됩니다."
				value={entry.code}
				oninput={(inputEvent) => {
					if (entry.type === 'eval') entry.code = inputEvent.currentTarget.value;
					onchanged();
				}}
			/>
			<p class="text-xs text-muted-foreground">
				ctx.vars(세션 변수) · ctx.phase(현재 페이즈) · ctx.trigger(이름) · ctx.log(메시지) 사용
				가능. false를 반환하면 시퀀스가 중단됩니다.
			</p>
		</div>
	{/if}
</div>
