<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import type { SequenceEntry } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
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
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.waitUntilEnd}
				onCheckedChange={(checked) => {
					if (entry.type === 'playSfx') entry.waitUntilEnd = checked;
					onchanged();
				}}
			/>
			끝날 때까지 대기
		</label>
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
					if (entry.type === 'playBgm') {
						entry.loop = checked;
						// Looping playback never "ends" — the wait option is moot.
						if (checked) entry.waitUntilEnd = false;
					}
					onchanged();
				}}
			/>
			반복 재생
		</label>
		{#if !entry.loop}
			<label class="flex h-8 items-center gap-2 text-xs">
				<Switch
					checked={entry.waitUntilEnd}
					onCheckedChange={(checked) => {
						if (entry.type === 'playBgm') entry.waitUntilEnd = checked;
						onchanged();
					}}
				/>
				끝날 때까지 대기
			</label>
		{/if}
		<p class="w-full text-xs text-muted-foreground">페이드 인/아웃은 BGM 애셋 설정을 따릅니다.</p>
	{:else if entry.type === 'adjustBgmVolume'}
		<AssetSelect kind="player" label="플레이어" bind:id={entry.playerId} {onchanged} />
		<Field.Field class="w-32 gap-1">
			<Field.FieldLabel for={`bgm-volume-${entry.id}`}>볼륨 (%)</Field.FieldLabel>
			<Input
				id={`bgm-volume-${entry.id}`}
				class="h-8"
				type="number"
				min="0"
				max="100"
				step="1"
				value={entry.value}
				onchange={(changeEvent) => {
					if (entry.type === 'adjustBgmVolume') {
						const value = Number(changeEvent.currentTarget.value);
						if (Number.isFinite(value)) entry.value = Math.max(0, Math.min(100, value));
					}
					onchanged();
				}}
			/>
		</Field.Field>
		<Field.Field class="w-32 gap-1">
			<Field.FieldLabel for={`bgm-volume-duration-${entry.id}`}>변화 시간 (ms)</Field.FieldLabel>
			<Input
				id={`bgm-volume-duration-${entry.id}`}
				class="h-8"
				type="number"
				min="0"
				step="100"
				value={entry.durationMs}
				onchange={(changeEvent) => {
					if (entry.type === 'adjustBgmVolume')
						entry.durationMs = parseMs(changeEvent.currentTarget.value, entry.durationMs, 0);
					onchanged();
				}}
			/>
		</Field.Field>
		<span class="text-xs text-muted-foreground">
			{entry.durationMs > 0 ? secondsHint(entry.durationMs) : '즉시 적용'}
		</span>
	{:else if entry.type === 'stopDialogue' || entry.type === 'stopSfx' || entry.type === 'stopVideo' || entry.type === 'stopBgm'}
		<AssetSelect
			kind="player"
			label="플레이어"
			bind:id={entry.playerId}
			disabled={entry.allPlayers}
			{onchanged}
		/>
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.allPlayers}
				onCheckedChange={(checked) => {
					if (
						entry.type === 'stopDialogue' ||
						entry.type === 'stopSfx' ||
						entry.type === 'stopVideo' ||
						entry.type === 'stopBgm'
					)
						entry.allPlayers = checked;
					onchanged();
				}}
			/>
			모든 플레이어
		</label>
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
		<div class="flex w-full flex-col gap-1.5">
			{#each entry.query as pair, index (index)}
				<div class="flex items-center gap-2">
					<Input
						class="h-8 w-40"
						placeholder="키"
						value={pair.key}
						aria-label="쿼리 파라미터 키"
						oninput={(inputEvent) => {
							pair.key = inputEvent.currentTarget.value;
							onchanged();
						}}
					/>
					<Input
						class="h-8 flex-1"
						placeholder="값"
						value={pair.value}
						aria-label="쿼리 파라미터 값"
						oninput={(inputEvent) => {
							pair.value = inputEvent.currentTarget.value;
							onchanged();
						}}
					/>
					<Button
						variant="ghost"
						size="icon"
						class="size-8 shrink-0"
						aria-label="쿼리 파라미터 삭제"
						onclick={() => {
							if (entry.type === 'navigate') entry.query.splice(index, 1);
							onchanged();
						}}
					>
						<XIcon class="size-4" />
					</Button>
				</div>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					class="h-7 text-xs"
					onclick={() => {
						if (entry.type === 'navigate') entry.query.push({ key: '', value: '' });
						onchanged();
					}}
				>
					<PlusIcon class="size-3.5" />
					쿼리 파라미터 추가
				</Button>
			</div>
			{#if entry.query.length > 0}
				<p class="text-xs text-muted-foreground">
					URL에 쿼리 파라미터로 추가됩니다. 값에는 {'{{vars.이름}}'} · {'{{payload.이름}}'} 치환을 쓸
					수 있습니다.
				</p>
			{/if}
		</div>
	{:else if entry.type === 'sendMessage'}
		<AssetSelect kind="device" label="장치" bind:id={entry.deviceId} {onchanged} />
		<AssetSelect kind="message" label="메시지" bind:id={entry.messageId} {onchanged} />
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.waitUntilEnd}
				onCheckedChange={(checked) => {
					if (entry.type === 'sendMessage') entry.waitUntilEnd = checked;
					onchanged();
				}}
			/>
			끝날 때까지 대기
		</label>
		<div class="w-full">
			<MessageValuesFields messageId={entry.messageId} values={entry.values} {onchanged} />
			<p class="mt-1 text-xs text-muted-foreground">
				값에는 {'{{vars.이름}}'} · {'{{payload.이름}}'} 치환을 쓸 수 있습니다. 값 전체가 하나의 치환이면
				변수의 타입(숫자·불리언 등)이 그대로 전달됩니다.
			</p>
		</div>
	{:else if entry.type === 'sendWebsiteRequest'}
		<AssetSelect kind="website" label="웹사이트" bind:id={entry.websiteId} {onchanged} />
		<div class="flex min-w-28 flex-col gap-1">
			<span class="text-xs text-muted-foreground">메서드</span>
			<Select.Root
				type="single"
				value={entry.method}
				onValueChange={(value) => {
					if (entry.type === 'sendWebsiteRequest')
						entry.method = value as
							'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
					onchanged();
				}}
			>
				<Select.Trigger size="sm" class="w-full" aria-label="HTTP 메서드">
					{entry.method}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						{#each ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as method (method)}
							<Select.Item value={method} label={method}>{method}</Select.Item>
						{/each}
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</div>
		<div class="flex min-w-64 flex-1 flex-col gap-1">
			<span class="text-xs text-muted-foreground">경로</span>
			<Input
				class="h-8 font-mono text-xs"
				placeholder="/api/action"
				value={entry.path}
				aria-label="요청 경로"
				oninput={(inputEvent) => {
					if (entry.type === 'sendWebsiteRequest') entry.path = inputEvent.currentTarget.value;
					onchanged();
				}}
			/>
		</div>
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.waitUntilEnd}
				onCheckedChange={(checked) => {
					if (entry.type === 'sendWebsiteRequest') entry.waitUntilEnd = checked;
					onchanged();
				}}
			/>
			끝날 때까지 대기
		</label>
		<div class="flex w-full flex-col gap-1">
			<span class="text-xs text-muted-foreground">본문</span>
			<Textarea
				class="min-h-20 font-mono text-xs"
				rows={3}
				placeholder={'{"key":"value"}'}
				value={entry.body}
				disabled={entry.method === 'GET' || entry.method === 'HEAD'}
				aria-label="요청 본문"
				oninput={(inputEvent) => {
					if (entry.type === 'sendWebsiteRequest') entry.body = inputEvent.currentTarget.value;
					onchanged();
				}}
			/>
			{#if entry.method === 'GET' || entry.method === 'HEAD'}
				<p class="text-xs text-muted-foreground">GET/HEAD 요청에는 본문을 보내지 않습니다.</p>
			{/if}
		</div>
		<div class="flex w-full flex-col gap-1.5">
			<span class="text-xs text-muted-foreground">헤더</span>
			{#each entry.headers as header, index (index)}
				<div class="flex items-center gap-2">
					<Input
						class="h-8 w-48 font-mono text-xs"
						placeholder="Content-Type"
						value={header.key}
						aria-label="헤더 이름"
						oninput={(inputEvent) => {
							header.key = inputEvent.currentTarget.value;
							onchanged();
						}}
					/>
					<Input
						class="h-8 flex-1 font-mono text-xs"
						placeholder="application/json"
						value={header.value}
						aria-label="헤더 값"
						oninput={(inputEvent) => {
							header.value = inputEvent.currentTarget.value;
							onchanged();
						}}
					/>
					<Button
						variant="ghost"
						size="icon"
						class="size-8 shrink-0"
						aria-label="헤더 삭제"
						onclick={() => {
							if (entry.type === 'sendWebsiteRequest') entry.headers.splice(index, 1);
							onchanged();
						}}
					>
						<XIcon class="size-4" />
					</Button>
				</div>
			{/each}
			<div>
				<Button
					variant="outline"
					size="sm"
					class="h-7 text-xs"
					onclick={() => {
						if (entry.type === 'sendWebsiteRequest') entry.headers.push({ key: '', value: '' });
						onchanged();
					}}
				>
					<PlusIcon class="size-3.5" />
					헤더 추가
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				경로, 본문, 헤더에는 {'{{vars.이름}}'} · {'{{payload.이름}}'} 치환을 쓸 수 있습니다.
			</p>
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
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.waitUntilFinish}
				onCheckedChange={(checked) => {
					if (entry.type === 'callEvent') entry.waitUntilFinish = checked;
					onchanged();
				}}
			/>
			끝날 때까지 대기
		</label>
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
	{:else if entry.type === 'endTheme'}
		<div class="flex min-w-36 flex-col gap-1">
			<span class="text-xs text-muted-foreground">판정</span>
			<Select.Root
				type="single"
				value={entry.verdict}
				onValueChange={(value) => {
					if (entry.type === 'endTheme') entry.verdict = value as 'success' | 'fail';
					onchanged();
				}}
			>
				<Select.Trigger size="sm" class="w-full" aria-label="판정">
					{entry.verdict === 'success' ? '성공' : '실패'}
				</Select.Trigger>
				<Select.Content>
					<Select.Group>
						<Select.Item value="success" label="성공">성공</Select.Item>
						<Select.Item value="fail" label="실패">실패</Select.Item>
					</Select.Group>
				</Select.Content>
			</Select.Root>
		</div>
		<p class="w-full text-xs text-muted-foreground">
			모든 장치를 리셋하고 판정을 운영 화면에 표시한 뒤 세션을 종료합니다.
		</p>
	{:else if entry.type === 'notify'}
		<div class="flex w-full flex-col gap-1">
			<Input
				class="h-8"
				placeholder="운영자에게 표시할 메시지"
				value={entry.message}
				aria-label="알림 메시지"
				oninput={(inputEvent) => {
					if (entry.type === 'notify') entry.message = inputEvent.currentTarget.value;
					onchanged();
				}}
			/>
			<p class="text-xs text-muted-foreground">운영 화면에 알림으로 표시됩니다.</p>
		</div>
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
				ctx.vars(세션 변수) · ctx.payload(트리거 페이로드, 없으면 null) · ctx.phase(현재 페이즈) ·
				ctx.trigger(이름) · ctx.log(메시지) · ctx.switchPhase(페이즈 이름) · ctx.notify(메시지) ·
				ctx.adjustTimer(ms | 'pause' | 'resume') · ctx.endTheme('success' | 'fail') 사용 가능.
				false를 반환하면 시퀀스가 중단되며, switchPhase 등의 동작은 스크립트 종료 후 호출 순서대로
				실행됩니다.
			</p>
		</div>
	{:else if entry.type === 'showHintCode'}
		<AssetSelect kind="hint" label="힌트" bind:id={entry.hintId} {onchanged} />
		<AssetSelect kind="device" label="장치" bind:id={entry.deviceId} {onchanged} />
		<p class="w-full text-xs text-muted-foreground">
			장치 화면 우상단에 힌트 입력 코드를 표시합니다. 스타일은 장치 애셋의 힌트 코드 CSS를 따릅니다.
		</p>
	{:else if entry.type === 'hideHintCode'}
		<AssetSelect
			kind="device"
			label="장치"
			bind:id={entry.deviceId}
			disabled={entry.allDevices}
			{onchanged}
		/>
		<label class="flex h-8 items-center gap-2 text-xs">
			<Switch
				checked={entry.allDevices}
				onCheckedChange={(checked) => {
					if (entry.type === 'hideHintCode') entry.allDevices = checked;
					onchanged();
				}}
			/>
			모든 장치
		</label>
	{/if}
</div>
