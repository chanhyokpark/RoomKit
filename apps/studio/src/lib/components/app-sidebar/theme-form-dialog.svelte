<script lang="ts">
	import { toast } from 'svelte-sonner';
	import type { Theme } from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { ApiError } from '$lib/api/client';
	import { createTheme, updateTheme } from '$lib/api/themes';
	import { themesStore } from '$lib/stores/themes.svelte';

	let {
		open = $bindable(false),
		theme = null,
		onSaved
	}: {
		open?: boolean;
		/** Null → create mode; a theme → rename/edit mode. */
		theme?: Theme | null;
		onSaved?: (theme: Theme) => void;
	} = $props();

	let name = $state('');
	let timeLimitMinutes = $state('');
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	$effect(() => {
		if (open) {
			name = theme?.name ?? '';
			timeLimitMinutes = theme?.timeLimitMs ? String(theme.timeLimitMs / 60_000) : '';
			errorMessage = null;
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		const minutes = timeLimitMinutes.trim() === '' ? null : Number(timeLimitMinutes);
		if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) {
			errorMessage = '제한 시간은 0보다 큰 숫자여야 합니다.';
			return;
		}
		submitting = true;
		errorMessage = null;
		try {
			const input = {
				name: name.trim(),
				timeLimitMs: minutes === null ? null : Math.round(minutes * 60_000)
			};
			const saved = theme ? await updateTheme(theme.id, input) : await createTheme(input);
			await themesStore.refresh();
			toast.success(theme ? '테마를 수정했습니다.' : '테마를 만들었습니다.');
			open = false;
			onSaved?.(saved);
		} catch (error) {
			errorMessage = error instanceof ApiError ? error.message : '저장에 실패했습니다.';
		} finally {
			submitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{theme ? '테마 수정' : '새 테마'}</Dialog.Title>
			<Dialog.Description>
				{theme ? '테마 이름과 제한 시간을 수정합니다.' : '새로운 테마를 만듭니다.'}
			</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={handleSubmit}>
			<Field.FieldGroup>
				<Field.Field>
					<Field.FieldLabel for="theme-name">이름</Field.FieldLabel>
					<Input id="theme-name" required bind:value={name} placeholder="예: 좀비 연구소" />
				</Field.Field>
				<Field.Field data-invalid={errorMessage ? true : undefined}>
					<Field.FieldLabel for="theme-time-limit">제한 시간 (분)</Field.FieldLabel>
					<Input
						id="theme-time-limit"
						type="number"
						min="1"
						step="1"
						bind:value={timeLimitMinutes}
						placeholder="비워 두면 타이머 없음"
						aria-invalid={errorMessage ? true : undefined}
					/>
					{#if errorMessage}
						<Field.FieldDescription class="text-destructive">{errorMessage}</Field.FieldDescription>
					{/if}
				</Field.Field>
				<Dialog.Footer>
					<Button type="button" variant="outline" onclick={() => (open = false)}>취소</Button>
					<Button type="submit" disabled={submitting || name.trim() === ''}>
						{#if submitting}
							<Spinner data-icon="inline-start" />
						{/if}
						저장
					</Button>
				</Dialog.Footer>
			</Field.FieldGroup>
		</form>
	</Dialog.Content>
</Dialog.Root>
