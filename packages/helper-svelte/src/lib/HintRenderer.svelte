<!--
  Headless renderer for the current hint step: HTML content, optional image,
  and prev/next navigation — next turns into "show answer" on the last step
  of a hint with an explicit answer. Unstyled; hook into `.rk-hint*` classes.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HintErrorReason, RoomKitHintApi } from './core.js';
	import { getRoomKit } from './roomkit.js';

	const DEFAULT_ERRORS: Record<HintErrorReason, string> = {
		unknown_code: '등록되지 않은 힌트 코드입니다.',
		unknown_hint: '힌트를 찾을 수 없습니다.',
		invalid_step: '해당 단계가 없습니다.',
		not_hint_device: '이 장치는 힌트 장치가 아닙니다.',
		session_not_running: '세션이 진행 중이 아닙니다.'
	};

	let {
		hint,
		class: className = 'rk-hint',
		labels,
		errorLabels,
		closable = true,
		empty
	}: {
		/** Hint facade to render; defaults to the context's `getRoomKit().hint`. */
		hint?: RoomKitHintApi;
		/** Root class hook. Default 'rk-hint'. */
		class?: string;
		labels?: {
			prev?: string;
			next?: string;
			/** Next-button label on the last step when the hint has an answer. */
			showAnswer?: string;
			/** Step indicator when the answer is shown. */
			answer?: string;
			close?: string;
		};
		/** Per-reason error texts; merged over the Korean defaults. */
		errorLabels?: Partial<Record<HintErrorReason, string>>;
		/** Show a dismiss button that clears the current hint. Default true. */
		closable?: boolean;
		/** Rendered while no hint is shown (and no error). */
		empty?: Snippet;
	} = $props();

	const rk = getRoomKit();
	const h = $derived(hint ?? rk.hint);
	const data = $derived(h.data);
	const error = $derived(h.error);
</script>

{#if !data && !error}
	{@render empty?.()}
{:else}
	<div class={className} data-answer={data?.isAnswer || undefined}>
		{#if error}
			<p class="{className}-error" role="alert">
				{errorLabels?.[error.reason] ?? DEFAULT_ERRORS[error.reason]}
			</p>
		{/if}
		{#if data}
			<div class="{className}-header">
				<span class="{className}-code">{data.code}</span>
				<span class="{className}-step">
					{data.isAnswer ? (labels?.answer ?? '정답') : `${data.step + 1} / ${data.stepCount}`}
				</span>
				{#if closable}
					<button type="button" class="{className}-close" onclick={() => h.dismiss()}>
						{labels?.close ?? '닫기'}
					</button>
				{/if}
			</div>
			<!-- Hint HTML is trusted admin input (authored in studio). -->
			<div class="{className}-body">{@html data.textHtml}</div>
			{#if data.imageUrl}
				<img class="{className}-image" src={data.imageUrl} alt="" />
			{/if}
			<div class="{className}-nav">
				<button
					type="button"
					class="{className}-prev"
					disabled={!h.hasPrev || h.pending}
					onclick={() => h.prev()}
				>
					{labels?.prev ?? '이전'}
				</button>
				<button
					type="button"
					class="{className}-next"
					data-answer={h.nextIsAnswer || undefined}
					disabled={!h.hasNext || h.pending}
					onclick={() => h.next()}
				>
					{h.nextIsAnswer ? (labels?.showAnswer ?? '정답 보기') : (labels?.next ?? '다음')}
				</button>
			</div>
		{/if}
	</div>
{/if}
