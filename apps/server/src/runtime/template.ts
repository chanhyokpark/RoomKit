import type { JsonValue } from '@roomkit/shared';

/**
 * Interpolation scope for authored `{{...}}` templates. Both sources are
 * optional so contexts without a live session (website test) resolve nothing.
 */
export interface TemplateScope {
  vars?: Record<string, JsonValue>;
  /** The device trigger payload of the run, when there is one. */
  payload?: JsonValue | null;
}

/** `{{vars.a.b}}` / `{{payload}}` — a source root plus an optional dot path. */
const TEMPLATE_RE = /\{\{\s*(vars|payload)((?:\.[^.\s{}]+)*)\s*\}\}/g;
const EXACT_TEMPLATE_RE = /^\{\{\s*(vars|payload)((?:\.[^.\s{}]+)*)\s*\}\}$/;

function resolvePath(
  scope: TemplateScope,
  source: 'vars' | 'payload',
  dotPath: string,
): JsonValue | undefined {
  let current: JsonValue | undefined =
    source === 'vars' ? (scope.vars ?? {}) : (scope.payload ?? null);
  for (const segment of dotPath.split('.').filter(Boolean)) {
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function stringify(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (value === null || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Resolves `{{vars.x}}` / `{{payload.x}}` templates in a string, always
 * producing a string (unresolved paths become the empty string).
 */
export function interpolateString(
  template: string,
  scope: TemplateScope,
): string {
  return template.replace(TEMPLATE_RE, (_match, source, dotPath) =>
    stringify(resolvePath(scope, source as 'vars' | 'payload', dotPath)),
  );
}

/**
 * Deep template interpolation over a JSON value. A string that is exactly one
 * template keeps the resolved value's JSON type (`"{{vars.score}}"` → 42);
 * an unresolved exact template becomes null. Mixed strings stringify each
 * template in place. Non-string leaves pass through unchanged.
 */
export function interpolate(value: JsonValue, scope: TemplateScope): JsonValue {
  if (typeof value === 'string') {
    const exact = EXACT_TEMPLATE_RE.exec(value);
    if (exact) {
      return (
        resolvePath(scope, exact[1] as 'vars' | 'payload', exact[2]) ?? null
      );
    }
    return interpolateString(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, scope));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, scope)]),
    );
  }
  return value;
}
