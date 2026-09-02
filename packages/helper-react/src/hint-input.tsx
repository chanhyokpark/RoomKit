import { useState, type FormEvent } from 'react';
import { useRoomKit } from './context.js';
import type { RoomKitHintApi } from './core.js';

export interface HintInputProps {
  /** Hint facade to drive; defaults to the context's `useRoomKit().hint`. */
  hint?: RoomKitHintApi;
  /** 'keypad' (default) renders on-screen digit keys; 'text' a plain input. */
  variant?: 'keypad' | 'text';
  /** Max code length (keypad ignores further digits). Default 8. */
  maxLength?: number;
  /** Called instead of the default submit (hint.submit). */
  onSubmit?: (code: string) => void;
  /** Root class hook. Default 'rk-hint-input'. */
  className?: string;
  labels?: { submit?: string; clear?: string; backspace?: string; placeholder?: string };
}

/**
 * Headless hint-code entry. Emits semantic, unstyled DOM with class hooks
 * (`.rk-hint-input`, `.rk-hint-input-key`, ...). Submitting sends the code
 * through the player bridge; the reply lands in the hint facade (rendered by
 * HintRenderer).
 */
export function HintInput({
  hint,
  variant = 'keypad',
  maxLength = 8,
  onSubmit,
  className = 'rk-hint-input',
  labels,
}: HintInputProps) {
  const rk = useRoomKit();
  const h = hint ?? rk.hint;
  const [value, setValue] = useState('');
  const disabled = h.pending;

  const submit = (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    if (onSubmit) onSubmit(trimmed);
    else h.submit(trimmed);
    setValue('');
  };

  if (variant === 'text') {
    const handleSubmit = (event: FormEvent) => {
      event.preventDefault();
      submit(value);
    };
    return (
      <form className={className} data-variant="text" onSubmit={handleSubmit}>
        <input
          className={`${className}-field`}
          value={value}
          maxLength={maxLength}
          placeholder={labels?.placeholder ?? '힌트 코드'}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled}
        />
        <button type="submit" className={`${className}-submit`} disabled={disabled}>
          {labels?.submit ?? '확인'}
        </button>
      </form>
    );
  }

  const press = (digit: string) => {
    setValue((v) => (v.length >= maxLength ? v : v + digit));
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className={className} data-variant="keypad">
      <output className={`${className}-display`}>{value}</output>
      <div className={`${className}-keys`}>
        {keys.map((digit) => (
          <button
            key={digit}
            type="button"
            className={`${className}-key`}
            data-key={digit}
            disabled={disabled}
            onClick={() => press(digit)}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className={`${className}-key ${className}-key-clear`}
          data-key="clear"
          disabled={disabled}
          onClick={() => setValue('')}
        >
          {labels?.clear ?? 'C'}
        </button>
        <button
          type="button"
          className={`${className}-key`}
          data-key="0"
          disabled={disabled}
          onClick={() => press('0')}
        >
          0
        </button>
        <button
          type="button"
          className={`${className}-key ${className}-key-back`}
          data-key="backspace"
          disabled={disabled}
          onClick={() => setValue((v) => v.slice(0, -1))}
        >
          {labels?.backspace ?? '⌫'}
        </button>
      </div>
      <button
        type="button"
        className={`${className}-submit`}
        disabled={disabled || value.length === 0}
        onClick={() => submit(value)}
      >
        {labels?.submit ?? '확인'}
      </button>
    </div>
  );
}
