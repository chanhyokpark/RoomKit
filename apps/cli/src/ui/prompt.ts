import * as p from '@clack/prompts';
import { ToolError } from '../core/session.js';

/**
 * Every prompt goes through here so non-interactive runs (--json, --yes,
 * CI, pipes) fail fast with the flags that would have answered the
 * question, instead of hanging on stdin.
 */
export interface Interactivity {
  interactive(): boolean;
}

export function requireInteractive(ctx: Interactivity, flags: string[]): void {
  if (!ctx.interactive()) {
    throw new ToolError(
      `대화형 입력을 사용할 수 없습니다 (--json/--yes/CI/비TTY). 다음 옵션을 지정해 주세요: ${flags.join(', ')}`,
      'missing_input',
    );
  }
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new ToolError('cancelled', 'cancelled');
  return value as T;
}

export async function text(
  ctx: Interactivity,
  flags: string[],
  opts: { message: string; placeholder?: string; initialValue?: string; validate?: (v: string) => string | undefined },
): Promise<string> {
  requireInteractive(ctx, flags);
  const { validate, ...rest } = opts;
  return unwrap(await p.text({ ...rest, validate: validate ? (v) => validate(v ?? '') : undefined }));
}

export async function password(ctx: Interactivity, flags: string[], message: string): Promise<string> {
  requireInteractive(ctx, flags);
  return unwrap(await p.password({ message, validate: (v) => (v ? undefined : '값을 입력해 주세요.') }));
}

export interface Choice<T> {
  value: T;
  label: string;
  hint?: string;
}

export async function select<T>(
  ctx: Interactivity,
  flags: string[],
  message: string,
  options: Choice<T>[],
  initialValue?: T,
): Promise<T> {
  requireInteractive(ctx, flags);
  if (!options.length) throw new ToolError(`선택할 항목이 없습니다: ${message}`, 'missing_input');
  return unwrap(await p.select<T>({ message, options: options as never, initialValue, maxItems: 12 }));
}

export async function multiselect<T>(
  ctx: Interactivity,
  flags: string[],
  message: string,
  options: Choice<T>[],
  initialValues: T[] = [],
  required = false,
): Promise<T[]> {
  requireInteractive(ctx, flags);
  return unwrap(await p.multiselect<T>({ message, options: options as never, initialValues, required }));
}

/** Confirmation: `--yes` answers true without prompting; non-interactive without --yes fails. */
export async function confirm(ctx: Interactivity & { yes: boolean }, message: string, initialValue = false): Promise<boolean> {
  if (ctx.yes) return true;
  requireInteractive(ctx, ['--yes']);
  return unwrap(await p.confirm({ message, initialValue }));
}

export interface Spinner {
  update(msg: string): void;
  stop(msg?: string): void;
  fail(msg: string): void;
}

/** Spinner on a terminal; plain stderr lines otherwise (keeps stdout JSON clean). */
export function spinner(ctx: Interactivity, message: string): Spinner {
  if (!ctx.interactive()) {
    process.stderr.write(`${message}\n`);
    return {
      update: (msg) => process.stderr.write(`${msg}\n`),
      stop: (msg) => msg && process.stderr.write(`${msg}\n`),
      fail: (msg) => process.stderr.write(`${msg}\n`),
    };
  }
  const s = p.spinner();
  s.start(message);
  return { update: (msg) => s.message(msg), stop: (msg) => s.stop(msg), fail: (msg) => s.error(msg) };
}

export const intro = (title: string) => p.intro(title);
export const outro = (text: string) => p.outro(text);
export const note = (text: string, title?: string) => p.note(text, title);
export const log = p.log;
