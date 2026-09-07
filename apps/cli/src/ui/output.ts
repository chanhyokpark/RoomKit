import pc from 'picocolors';
import { z } from 'zod';
import { ApiError } from '../core/http.js';
import { ToolError } from '../core/session.js';

/** Exit codes: 0 ok, 1 runtime/API error, 2 usage, 3 not logged in, 4 no theme, 130 cancelled. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ToolError) {
    switch (err.code) {
      case 'usage':
      case 'missing_input':
      case 'bad_config':
      case 'no_project':
        return 2;
      case 'not_logged_in':
        return 3;
      case 'theme_required':
        return 4;
      case 'cancelled':
        return 130;
      default:
        return 1;
    }
  }
  if (err instanceof z.ZodError) return 2;
  return 1;
}

export interface ErrorJson {
  error: { code: string; message: string; status?: number; details?: unknown };
}

export function errorToJson(err: unknown): ErrorJson {
  if (err instanceof ApiError) {
    return { error: { code: 'api_error', message: err.message, status: err.status, details: err.body ?? undefined } };
  }
  if (err instanceof z.ZodError) {
    return { error: { code: 'validation', message: z.prettifyError(err), details: err.issues } };
  }
  if (err instanceof ToolError) return { error: { code: err.code, message: err.message } };
  if (err instanceof Error) return { error: { code: 'error', message: err.message } };
  return { error: { code: 'error', message: String(err) } };
}

/** Human (Korean) rendering of any failure. Detail lines stay English (they come from core/server). */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    let text = `서버 오류 (HTTP ${err.status}): ${err.message}`;
    if (err.status === 400) text += `\n${pc.dim('입력 형식은 `rk describe commands` / `rk describe asset <kind>` 로 확인할 수 있습니다.')}`;
    if (err.status === 404) text += `\n${pc.dim('대상이 존재하는지, 현재 테마가 맞는지 확인해 주세요 (`rk status`).')}`;
    return text;
  }
  if (err instanceof z.ZodError) return `입력값이 올바르지 않습니다:\n${z.prettifyError(err)}`;
  if (err instanceof ToolError) {
    switch (err.code) {
      case 'not_logged_in':
        return `로그인이 필요합니다. \`rk login\` 을 먼저 실행해 주세요.\n${pc.dim(err.message)}`;
      case 'theme_required':
        return '테마가 지정되지 않았습니다. `rk theme use <이름|uuid>` 로 프로젝트 테마를 정하거나 `--theme` 옵션을 사용해 주세요.';
      case 'cancelled':
        return '취소했습니다.';
      default:
        return err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---- output helpers -------------------------------------------------------

export const out = {
  line(text = ''): void {
    process.stdout.write(`${text}\n`);
  },
  err(text = ''): void {
    process.stderr.write(`${text}\n`);
  },
  ok(text: string): void {
    process.stdout.write(`${pc.green('✔')} ${text}\n`);
  },
  warn(text: string): void {
    process.stderr.write(`${pc.yellow('!')} ${text}\n`);
  },
  info(text: string): void {
    process.stdout.write(`${pc.cyan('ℹ')} ${text}\n`);
  },
  fail(text: string): void {
    process.stderr.write(`${pc.red('✖')} ${text}\n`);
  },
  json(data: unknown): void {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  },
};

const ANSI = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, '');

/** Terminal columns of a string; East Asian wide characters take two. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const cp = ch.codePointAt(0)!;
    const wide =
      cp >= 0x1100 &&
      (cp <= 0x115f ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe30 && cp <= 0xfe4f) ||
        (cp >= 0xff00 && cp <= 0xff60) ||
        (cp >= 0xffe0 && cp <= 0xffe6));
    w += wide ? 2 : 1;
  }
  return w;
}

/** Minimal aligned table for human output. Cells are stringified; null/undefined → ''. */
export function table(headers: string[], rows: Array<Array<unknown>>): string {
  const cells = rows.map((r) => r.map((c) => (c === undefined || c === null ? '' : String(c))));
  const cols = headers.map((h, i) => Math.max(displayWidth(h), ...cells.map((r) => displayWidth(r[i] ?? ''))));
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - displayWidth(s)));
  const line = (r: string[]) => r.map((c, i) => pad(c, cols[i]!)).join('  ').trimEnd();
  return [pc.bold(line(headers)), ...cells.map(line)].join('\n');
}

/** Key/value block for single records. */
export function kv(pairs: Array<[string, unknown]>): string {
  const shown = pairs.filter(([, v]) => v !== undefined);
  const w = Math.max(...shown.map(([k]) => displayWidth(k)));
  return shown
    .map(([k, v]) => {
      const value = v === null ? pc.dim('null') : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${pc.dim(k + ' '.repeat(w - displayWidth(k)))}  ${value}`;
    })
    .join('\n');
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
