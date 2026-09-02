import type { ReactNode } from 'react';
import type { HintErrorReason } from '@roomkit/hintphone-core/standalone';
import { useRoomKit } from './context.js';
import type { RoomKitHintApi } from './core.js';

const DEFAULT_ERRORS: Record<HintErrorReason, string> = {
  unknown_code: '등록되지 않은 힌트 코드입니다.',
  unknown_hint: '힌트를 찾을 수 없습니다.',
  invalid_step: '해당 단계가 없습니다.',
  not_hint_device: '이 장치는 힌트 장치가 아닙니다.',
  session_not_running: '세션이 진행 중이 아닙니다.',
};

export interface HintRendererProps {
  /** Hint facade to render; defaults to the context's `useRoomKit().hint`. */
  hint?: RoomKitHintApi;
  /** Root class hook. Default 'rk-hint'. */
  className?: string;
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
  /** Rendered while no hint is shown (and no error). Default null. */
  empty?: ReactNode;
}

/**
 * Headless renderer for the current hint step: HTML content, optional image,
 * and prev/next navigation — next turns into "show answer" on the last step
 * of a hint with an explicit answer. Unstyled; hook into `.rk-hint*` classes.
 */
export function HintRenderer({
  hint,
  className = 'rk-hint',
  labels,
  errorLabels,
  closable = true,
  empty = null,
}: HintRendererProps) {
  const rk = useRoomKit();
  const h = hint ?? rk.hint;
  const { data, error } = h;

  if (!data && !error) return <>{empty}</>;

  return (
    <div className={className} data-answer={data?.isAnswer || undefined}>
      {error && (
        <p className={`${className}-error`} role="alert">
          {errorLabels?.[error.reason] ?? DEFAULT_ERRORS[error.reason]}
        </p>
      )}
      {data && (
        <>
          <div className={`${className}-header`}>
            <span className={`${className}-code`}>{data.code}</span>
            <span className={`${className}-step`}>
              {data.isAnswer
                ? (labels?.answer ?? '정답')
                : `${data.step + 1} / ${data.stepCount}`}
            </span>
            {closable && (
              <button
                type="button"
                className={`${className}-close`}
                onClick={() => h.dismiss()}
              >
                {labels?.close ?? '닫기'}
              </button>
            )}
          </div>
          <div
            className={`${className}-body`}
            // Hint HTML is trusted admin input (authored in studio).
            dangerouslySetInnerHTML={{ __html: data.textHtml }}
          />
          {data.imageUrl && (
            <img className={`${className}-image`} src={data.imageUrl} alt="" />
          )}
          <div className={`${className}-nav`}>
            <button
              type="button"
              className={`${className}-prev`}
              disabled={!h.hasPrev || h.pending}
              onClick={() => h.prev()}
            >
              {labels?.prev ?? '이전'}
            </button>
            <button
              type="button"
              className={`${className}-next`}
              data-answer={h.nextIsAnswer || undefined}
              disabled={!h.hasNext || h.pending}
              onClick={() => h.next()}
            >
              {h.nextIsAnswer
                ? (labels?.showAnswer ?? '정답 보기')
                : (labels?.next ?? '다음')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
