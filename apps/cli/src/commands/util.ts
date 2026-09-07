import type { Command } from 'commander';
import pc from 'picocolors';
import type { CliContext } from '../context.js';
import { out } from '../ui/output.js';

export type GetContext = () => CliContext;

export interface CommandModule {
  register(program: Command, ctx: GetContext): void;
}

/**
 * Standard result emission: `--json` prints the data (plus collected
 * warnings) to stdout; otherwise the human renderer runs and warnings go to
 * stderr.
 */
export function emit(ctx: CliContext, data: unknown, human: () => void): void {
  if (ctx.json) {
    const payload =
      ctx.warnings.length && data && typeof data === 'object' && !Array.isArray(data)
        ? { ...(data as Record<string, unknown>), warnings: ctx.warnings }
        : data;
    out.json(payload);
    return;
  }
  human();
  for (const w of ctx.warnings) out.warn(w);
  ctx.warnings.length = 0;
}

export function dim(text: string): string {
  return pc.dim(text);
}

/** Korean label for a hosted-site URL line etc. */
export function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('ko-KR', { hour12: false });
}
