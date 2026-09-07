import { readFileSync } from 'node:fs';
import type { ZodType } from 'zod';
import { ToolError } from '../core/session.js';

/**
 * JSON arguments accept three forms: inline JSON, `@path/to/file.json`, or
 * `-` for stdin. Parsed through `schema` when given.
 */
export function readJsonArg<T = unknown>(value: string, what: string, schema?: ZodType<T>): T {
  let text: string;
  if (value === '-') {
    text = readFileSync(0, 'utf8');
  } else if (value.startsWith('@')) {
    try {
      text = readFileSync(value.slice(1), 'utf8');
    } catch {
      throw new ToolError(`${what}: 파일을 읽을 수 없습니다: ${value.slice(1)}`, 'usage');
    }
  } else {
    text = value;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ToolError(`${what}: JSON 파싱 실패 — ${err instanceof Error ? err.message : String(err)}`, 'usage');
  }
  return schema ? schema.parse(parsed) : (parsed as T);
}

/** `key=value` repeated flags → pairs. */
export function parsePairs(values: string[] | undefined, flag: string): Array<[string, string]> {
  return (values ?? []).map((v) => {
    const i = v.indexOf('=');
    if (i <= 0) throw new ToolError(`${flag}: "${v}" 는 key=value 형식이어야 합니다.`, 'usage');
    return [v.slice(0, i), v.slice(i + 1)];
  });
}

/** Durations such as "90s", "5m", "1h", "1500ms", or plain milliseconds. */
export function parseDuration(value: string, flag: string): number {
  const m = /^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(value.trim());
  if (!m) throw new ToolError(`${flag}: "${value}" 는 숫자(ms) 또는 90s/5m/1h 형식이어야 합니다.`, 'usage');
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms') as 'ms' | 's' | 'm' | 'h';
  return Math.round(n * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit]);
}

export function parseInteger(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ToolError(`${flag}: 정수가 필요합니다 ("${value}").`, 'usage');
  return n;
}

/** Collects a repeatable option into an array (commander `argParser`). */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
