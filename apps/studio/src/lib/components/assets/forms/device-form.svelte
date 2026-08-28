<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Asset } from '@roomkit/shared';
	import { listAssets } from '$lib/api/assets';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';

	let {
		themeId,
		displayName = $bindable(),
		isHintDevice = $bindable(),
		hintCodeCss = $bindable(),
		startWebsiteId = $bindable(),
		startQuery = $bindable()
	}: {
		themeId: string;
		displayName: string;
		isHintDevice: boolean;
		hintCodeCss: string;
		startWebsiteId: string | null;
		startQuery: { key: string; value: string }[];
	} = $props();

	// Self-loaded: the asset editor has no theme-wide asset context here.
	let websites = $state<Asset[]>([]);
	$effect(() => {
		void listAssets(themeId, { kind: 'website' }).then((rows) => (websites = rows));
	});

	const selectedWebsite = $derived(websites.find((w) => w.id === startWebsiteId));
</script>

<Field.Field>
	<Field.FieldLabel for="device-display-name">표시 이름</Field.FieldLabel>
	<Input id="device-display-name" bind:value={displayName} placeholder="비워 두면 이름을 사용" />
	<Field.FieldDescription>
		운영 화면 등에 보여줄 이름입니다. 이름은 내부 식별용으로 유지됩니다.
	</Field.FieldDescription>
</Field.Field>

<Field.Field orientation="horizontal">
	<Field.FieldContent>
		<Field.FieldLabel for="device-hint">힌트 장치</Field.FieldLabel>
		<Field.FieldDescription>
			힌트 코드 입력 UI를 담당합니다. 힌트 전송도 이 장치로 갑니다.
		</Field.FieldDescription>
	</Field.FieldContent>
	<Switch id="device-hint" bind:checked={isHintDevice} />
</Field.Field>

<Field.Field>
	<Field.FieldLabel>시작 웹페이지</Field.FieldLabel>
	<Select.Root
		type="single"
		value={startWebsiteId ?? ''}
		onValueChange={(value) => {
			startWebsiteId = value === '' ? null : value;
			if (startWebsiteId === null) startQuery = [];
		}}
	>
		<Select.Trigger class="w-full" aria-label="시작 웹페이지">
			{selectedWebsite ? selectedWebsite.name : startWebsiteId ? '삭제된 애셋' : '없음'}
		</Select.Trigger>
		<Select.Content>
			<Select.Item value="">없음</Select.Item>
			{#each websites as website (website.id)}
				<Select.Item value={website.id}>{website.name}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
	<Field.FieldDescription>
		세션이 시작되면 이 장치가 자동으로 이동하는 웹사이트 애셋입니다. 세션 진행 중 접속한
		장치도 표시 중인 웹사이트가 없으면 이 페이지로 이동합니다.
	</Field.FieldDescription>
	{#if startWebsiteId !== null}
		<div class="flex flex-col gap-1.5">
			{#each startQuery as pair, i (i)}
				<div class="flex items-center gap-1.5">
					<Input class="flex-1 font-mono" placeholder="key" bind:value={pair.key} />
					<Input class="flex-1 font-mono" placeholder="value ({'{{vars.x}}'} 지원)" bind:value={pair.value} />
					<Button
						variant="ghost"
						size="icon"
						aria-label="쿼리 삭제"
						onclick={() => (startQuery = startQuery.filter((_, idx) => idx !== i))}
					>
						<XIcon class="size-4" />
					</Button>
				</div>
			{/each}
			<Button
				variant="outline"
				size="sm"
				class="self-start"
				onclick={() => (startQuery = [...startQuery, { key: '', value: '' }])}
			>
				<PlusIcon class="size-4" /> 쿼리 파라미터 추가
			</Button>
		</div>
	{/if}
</Field.Field>

<Field.Field>
	<Field.FieldLabel for="device-hint-code-css">힌트 코드 CSS</Field.FieldLabel>
	<Textarea
		id="device-hint-code-css"
		class="font-mono"
		rows={4}
		bind:value={hintCodeCss}
		placeholder={'.rk-hint-code { font-size: 4rem; }'}
	/>
	<Field.FieldDescription>
		힌트 코드 표시 명령으로 이 장치 화면(기본: 우상단)에 표시되는 코드의 스타일입니다.
	</Field.FieldDescription>
</Field.Field>
