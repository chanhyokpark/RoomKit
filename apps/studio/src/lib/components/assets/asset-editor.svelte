<script lang="ts">
	import { toast } from 'svelte-sonner';
	import {
		CODED_ASSET_KINDS,
		CreateAssetInputSchema,
		type Asset,
		type JsonValue,
		type Tag,
		type UpdateAssetInput
	} from '@roomkit/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Field from '$lib/components/ui/field';
	import { Input } from '$lib/components/ui/input';
	import { Spinner } from '$lib/components/ui/spinner';
	import { Textarea } from '$lib/components/ui/textarea';
	import { ApiError } from '$lib/api/client';
	import { createAsset, updateAsset } from '$lib/api/assets';
	import DeviceForm from './forms/device-form.svelte';
	import DialogueForm from './forms/dialogue-form.svelte';
	import EventForm from './forms/event-form.svelte';
	import FileAssetForm from './forms/file-asset-form.svelte';
	import HintForm from './forms/hint-form.svelte';
	import MessageForm from './forms/message-form.svelte';
	import PhaseForm from './forms/phase-form.svelte';
	import PlayerForm from './forms/player-form.svelte';
	import WebsiteForm from './forms/website-form.svelte';
	import TagPicker from './tag-picker.svelte';
	import type { Draft, EditorState } from './types';

	let {
		themeId,
		editing,
		tags,
		defaultPhaseId,
		onsaved,
		oncancel
	}: {
		themeId: string;
		editing: EditorState;
		tags: Tag[];
		/** Preselected phase for newly created events (editor workspace context). */
		defaultPhaseId?: string;
		onsaved: (asset: Asset) => void;
		oncancel: () => void;
	} = $props();

	const kind = $derived(editing.mode === 'create' ? editing.kind : editing.asset.kind);
	const isCoded = $derived((CODED_ASSET_KINDS as readonly string[]).includes(kind));

	// The host keys this component by editing target, so init-once is safe.
	// svelte-ignore state_referenced_locally
	let name = $state(editing.mode === 'edit' ? editing.asset.name : '');
	// svelte-ignore state_referenced_locally
	let code = $state(editing.mode === 'edit' ? (editing.asset.code ?? '') : '');
	// svelte-ignore state_referenced_locally
	let description = $state(editing.mode === 'edit' ? editing.asset.description : '');
	// svelte-ignore state_referenced_locally
	let tagIds = $state<string[]>(
		editing.mode === 'edit' ? editing.asset.tags.map((tag) => tag.id) : []
	);
	// svelte-ignore state_referenced_locally
	let draft = $state<Draft>(initDraft(editing));
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	function initDraft(state: EditorState): Draft {
		if (state.mode === 'edit') {
			const asset = state.asset;
			switch (asset.kind) {
				case 'device':
					return {
						kind: 'device',
						displayName: asset.data.displayName,
						isHintDevice: asset.data.isHintDevice
					};
				case 'bgm':
				case 'sfx':
				case 'video':
					return { kind: asset.kind, fileKey: asset.data.fileKey };
				case 'dialogue':
					return {
						kind: 'dialogue',
						keepSubtitleAfterEnd: asset.data.keepSubtitleAfterEnd,
						lines: asset.data.lines.map((line) => ({ ...line }))
					};
				case 'hint':
					return { kind: 'hint', steps: asset.data.steps.map((step) => ({ ...step })) };
				case 'player':
					return { kind: 'player', ...asset.data };
				case 'website':
					return { kind: 'website', url: asset.data.url };
				case 'message':
					return {
						kind: 'message',
						displayName: asset.data.displayName,
						fields: asset.data.fields.map((field) => ({ ...field }))
					};
				case 'phase':
					return { kind: 'phase', orderText: String(asset.data.order) };
				case 'event':
					return {
						kind: 'event',
						phaseId: asset.data.phaseId ?? '',
						triggerKind: asset.data.triggerKind,
						triggerName: asset.data.triggerName ?? '',
						manualTriggerable: asset.data.manualTriggerable,
						allowReentry: asset.data.allowReentry,
						sequence: asset.data.sequence
					};
			}
		}
		switch (state.kind) {
			case 'device':
				return { kind: 'device', displayName: '', isHintDevice: false };
			case 'bgm':
			case 'sfx':
			case 'video':
				return { kind: state.kind, fileKey: null };
			case 'dialogue':
				return { kind: 'dialogue', keepSubtitleAfterEnd: false, lines: [] };
			case 'hint':
				return { kind: 'hint', steps: [{ textHtml: '', imageKey: null }] };
			case 'player':
				return { kind: 'player', speakerDeviceId: '', screenDeviceId: '', subtitleCss: '' };
			case 'website':
				return { kind: 'website', url: '' };
			case 'message':
				return { kind: 'message', displayName: '', fields: [] };
			case 'phase':
				return { kind: 'phase', orderText: '' };
			case 'event':
				return {
					kind: 'event',
					phaseId: defaultPhaseId ?? '',
					triggerKind: 'device',
					triggerName: '',
					manualTriggerable: false,
					allowReentry: false,
					sequence: []
				};
		}
	}

	function validate(): string | null {
		if (!name.trim()) return '이름을 입력해 주세요.';
		switch (draft.kind) {
			case 'device':
				return code.trim() ? null : '장치 코드를 입력해 주세요.';
			case 'bgm':
			case 'sfx':
			case 'video':
				return draft.fileKey ? null : '파일을 업로드해 주세요.';
			case 'dialogue':
				return draft.lines.every((line) => line.fileKey)
					? null
					: '모든 라인에 음성 파일을 업로드해 주세요.';
			case 'player':
				return draft.speakerDeviceId && draft.screenDeviceId
					? null
					: '스피커 장치와 스크린 장치를 선택해 주세요.';
			case 'website':
				try {
					new URL(draft.url);
					return null;
				} catch {
					return '올바른 URL을 입력해 주세요.';
				}
			case 'message': {
				if (draft.fields.some((field) => !field.key.trim()))
					return '모든 필드에 키를 입력해 주세요.';
				const keys = draft.fields.map((field) => field.key.trim());
				if (new Set(keys).size !== keys.length) return '필드 키가 중복됩니다.';
				return null;
			}
			case 'phase': {
				const order = Number(draft.orderText);
				return draft.orderText.trim() !== '' && Number.isInteger(order)
					? null
					: '순서는 정수여야 합니다.';
			}
			case 'event':
				if (draft.triggerKind === 'device' && !draft.triggerName.trim())
					return '장치 트리거 이름을 입력해 주세요.';
				if (draft.triggerKind === 'system' && !draft.triggerName)
					return '시스템 훅을 선택해 주세요.';
				return null;
			default:
				return null;
		}
	}

	function buildData(): JsonValue {
		switch (draft.kind) {
			case 'device':
				return { displayName: draft.displayName, isHintDevice: draft.isHintDevice };
			case 'bgm':
			case 'sfx':
			case 'video':
				return { fileKey: draft.fileKey ?? '' };
			case 'dialogue':
				return {
					keepSubtitleAfterEnd: draft.keepSubtitleAfterEnd,
					lines: draft.lines.map((line) => ({
						id: line.id,
						fileKey: line.fileKey ?? '',
						subtitleHtml: line.subtitleHtml
					}))
				};
			case 'hint':
				return { steps: draft.steps.map((step) => ({ ...step })) };
			case 'player':
				return {
					speakerDeviceId: draft.speakerDeviceId,
					screenDeviceId: draft.screenDeviceId,
					subtitleCss: draft.subtitleCss
				};
			case 'website':
				return { url: draft.url };
			case 'message':
				return {
					displayName: draft.displayName,
					fields: draft.fields.map((field) => ({ ...field, key: field.key.trim() }))
				};
			case 'phase':
				return { order: Number(draft.orderText) };
			case 'event':
				return {
					phaseId: draft.phaseId || null,
					triggerKind: draft.triggerKind,
					triggerName: draft.triggerKind === 'manual' ? null : draft.triggerName.trim(),
					manualTriggerable: draft.manualTriggerable,
					allowReentry: draft.allowReentry,
					sequence: $state.snapshot(draft.sequence) as unknown as JsonValue
				} as JsonValue;
		}
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (submitting) return;
		const validationError = validate();
		if (validationError) {
			errorMessage = validationError;
			return;
		}
		submitting = true;
		errorMessage = null;
		try {
			const trimmedCode = code.trim();
			let saved: Asset;
			if (editing.mode === 'create') {
				const input = CreateAssetInputSchema.parse({
					kind,
					name: name.trim(),
					description: description.trim(),
					tagIds: [...tagIds],
					...(isCoded && trimmedCode ? { code: trimmedCode } : {}),
					data: buildData()
				});
				saved = await createAsset(themeId, input);
			} else {
				const input: UpdateAssetInput = {
					name: name.trim(),
					description: description.trim(),
					tagIds: [...tagIds],
					data: buildData(),
					...(isCoded && trimmedCode ? { code: trimmedCode } : {})
				};
				saved = await updateAsset(themeId, editing.asset.id, input);
			}
			toast.success(editing.mode === 'create' ? '애셋을 만들었습니다.' : '애셋을 수정했습니다.');
			onsaved(saved);
		} catch (error) {
			errorMessage = error instanceof ApiError ? error.message : '저장에 실패했습니다.';
		} finally {
			submitting = false;
		}
	}
</script>

<form class="flex flex-col gap-4" onsubmit={handleSubmit}>
	<Field.FieldGroup>
		<Field.Field>
			<Field.FieldLabel for="asset-name">이름</Field.FieldLabel>
			<Input id="asset-name" required bind:value={name} />
		</Field.Field>
		{#if isCoded}
			<Field.Field>
				<Field.FieldLabel for="asset-code">코드</Field.FieldLabel>
				<Input
					id="asset-code"
					bind:value={code}
					class="font-mono"
					placeholder={kind === 'hint' ? '비워 두면 4자리 자동 생성' : '테마 내에서 고유한 코드'}
				/>
				<Field.FieldDescription>
					{kind === 'hint'
						? '플레이어가 힌트 기기에 입력하는 코드입니다.'
						: '실제 장치 등록에 사용하는 코드입니다.'}
				</Field.FieldDescription>
			</Field.Field>
		{/if}
		<Field.Field>
			<Field.FieldLabel for="asset-description">설명</Field.FieldLabel>
			<Textarea
				id="asset-description"
				bind:value={description}
				rows={2}
				placeholder="이 애셋에 대한 메모 (선택)"
			/>
		</Field.Field>
		<Field.Field>
			<Field.FieldLabel>태그</Field.FieldLabel>
			<TagPicker {tags} bind:tagIds />
		</Field.Field>
		{#if draft.kind === 'device'}
			<DeviceForm bind:displayName={draft.displayName} bind:isHintDevice={draft.isHintDevice} />
		{:else if draft.kind === 'bgm' || draft.kind === 'sfx'}
			<FileAssetForm {themeId} bind:fileKey={draft.fileKey} accept="audio/*" media="audio" />
		{:else if draft.kind === 'video'}
			<FileAssetForm {themeId} bind:fileKey={draft.fileKey} accept="video/*" media="video" />
		{:else if draft.kind === 'dialogue'}
			<DialogueForm
				{themeId}
				bind:keepSubtitleAfterEnd={draft.keepSubtitleAfterEnd}
				bind:lines={draft.lines}
			/>
		{:else if draft.kind === 'hint'}
			<HintForm {themeId} bind:steps={draft.steps} />
		{:else if draft.kind === 'player'}
			<PlayerForm
				{themeId}
				bind:speakerDeviceId={draft.speakerDeviceId}
				bind:screenDeviceId={draft.screenDeviceId}
				bind:subtitleCss={draft.subtitleCss}
			/>
		{:else if draft.kind === 'website'}
			<WebsiteForm bind:url={draft.url} />
		{:else if draft.kind === 'message'}
			<MessageForm bind:displayName={draft.displayName} bind:fields={draft.fields} />
		{:else if draft.kind === 'phase'}
			<PhaseForm bind:orderText={draft.orderText} />
		{:else if draft.kind === 'event'}
			<EventForm
				{themeId}
				bind:phaseId={draft.phaseId}
				bind:triggerKind={draft.triggerKind}
				bind:triggerName={draft.triggerName}
				bind:manualTriggerable={draft.manualTriggerable}
				bind:allowReentry={draft.allowReentry}
				sequenceLength={draft.sequence.length}
			/>
		{/if}
		{#if errorMessage}
			<p class="text-sm text-destructive">{errorMessage}</p>
		{/if}
		<div class="flex justify-end gap-2">
			<Button type="button" variant="outline" onclick={oncancel}>취소</Button>
			<Button type="submit" disabled={submitting}>
				{#if submitting}
					<Spinner data-icon="inline-start" />
				{/if}
				저장
			</Button>
		</div>
	</Field.FieldGroup>
</form>
