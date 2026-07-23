<script lang="ts">
	import LightbulbIcon from '@lucide/svelte/icons/lightbulb';
	import SendIcon from '@lucide/svelte/icons/send';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Select from '$lib/components/ui/select';
	import { pushHint } from '$lib/api/sessions';
	import { useOperationData, type SessionView } from './operation-data.svelte';
	import { toastApiError } from '$lib/api/client';

	let { session, disabled }: { session: SessionView; disabled: boolean } = $props();

	const data = useOperationData();

	let hintId = $state('');
	let stepText = $state('0');
	let busy = $state(false);

	const selectedHint = $derived(data.hints.find((h) => h.id === hintId) ?? null);
	const stepCount = $derived(selectedHint?.data.steps.length ?? 0);
	const hasHintDevice = $derived(data.devices.some((d) => d.data.isHintDevice));
	// Clamped defensively: the hint may have been edited to fewer steps.
	const step = $derived(Math.min(Number(stepText), Math.max(0, stepCount - 1)));

	function hintLabel(hint: (typeof data.hints)[number]): string {
		return hint.code ? `${hint.code} · ${hint.name}` : hint.name;
	}

	async function handlePush(): Promise<void> {
		if (busy || !hintId) return;
		busy = true;
		try {
			await pushHint(session.id, { hintId, step });
			toast.success('힌트를 전송했습니다.');
		} catch (err) {
			toastApiError(err, '힌트 전송에 실패했습니다.');
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="flex items-center gap-2">
			<LightbulbIcon class="size-4" />
			힌트 전송
		</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		{#if data.hints.length === 0}
			<p class="text-sm text-muted-foreground">이 테마에 힌트 애셋이 없습니다.</p>
		{:else}
			{#if !hasHintDevice}
				<p class="text-sm text-destructive">
					힌트 장치가 없습니다. 장치 애셋에서 힌트 장치를 지정하세요.
				</p>
			{/if}
			<Select.Root type="single" bind:value={hintId} onValueChange={() => (stepText = '0')}>
				<Select.Trigger class="w-full" disabled={disabled || busy}>
					{selectedHint ? hintLabel(selectedHint) : '힌트 선택'}
				</Select.Trigger>
				<Select.Content>
					{#each data.hints as hint (hint.id)}
						<Select.Item value={hint.id} label={hintLabel(hint)}>{hintLabel(hint)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<div class="flex items-center gap-2">
				<Select.Root type="single" bind:value={stepText}>
					<Select.Trigger class="flex-1" disabled={disabled || busy || !selectedHint}>
						{selectedHint ? `${step + 1}단계` : '단계'}
					</Select.Trigger>
					<Select.Content>
						{#each Array.from({ length: stepCount }, (_, i) => i) as index (index)}
							<Select.Item value={String(index)} label={`${index + 1}단계`}>
								{index + 1}단계
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button size="sm" disabled={disabled || busy || !hintId} onclick={handlePush}>
					<SendIcon data-icon="inline-start" />
					전송
				</Button>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
