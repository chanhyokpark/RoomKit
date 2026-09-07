import type { Theme } from '@roomkit/shared';
import type { CliContext } from '../context.js';
import { normalizeServerUrl } from '../core/http.js';
import { findTheme, listThemes } from '../core/ops/themes.js';
import { isUuid } from '../core/refs.js';
import { ToolError } from '../core/session.js';
import { select } from '../ui/prompt.js';

const NO_THEME = 'No theme selected. Run `rk theme use <ref>` or pass --theme.';

/**
 * Effective theme for a command: explicit reference (argument, then --theme)
 * wins over roomkit.json; on a terminal an interactive picker is the last
 * resort. Returns the uuid without a network round-trip when possible.
 */
export async function resolveThemeId(ctx: CliContext, ref?: string): Promise<string> {
  const explicit = ref ?? ctx.flags.theme;
  if (explicit) {
    if (isUuid(explicit)) return explicit;
    return (await findTheme(ctx, explicit)).id;
  }
  const fromProject = ctx.project?.config.theme;
  if (fromProject) {
    await warnServerMismatch(ctx);
    return fromProject.id;
  }
  if (ctx.interactive()) return (await pickTheme(ctx, '작업할 테마를 선택해 주세요')).id;
  throw new ToolError(NO_THEME, 'theme_required');
}

/** Like resolveThemeId but returns the full Theme (one request). */
export async function resolveTheme(ctx: CliContext, ref?: string): Promise<Theme> {
  const explicit = ref ?? ctx.flags.theme;
  if (explicit) return findTheme(ctx, explicit);
  const fromProject = ctx.project?.config.theme;
  if (fromProject) {
    await warnServerMismatch(ctx);
    return findTheme(ctx, fromProject.id);
  }
  if (ctx.interactive()) return pickTheme(ctx, '작업할 테마를 선택해 주세요');
  throw new ToolError(NO_THEME, 'theme_required');
}

let warned = false;
/** Theme ids are per server: flag a roomkit.json that points elsewhere than the login. */
export async function warnServerMismatch(ctx: CliContext): Promise<void> {
  const configured = ctx.project?.config.server;
  if (warned || !configured) return;
  await ctx.api.ensureLogin();
  if (normalizeServerUrl(configured) !== ctx.state.apiUrl) {
    warned = true;
    ctx.warn(
      `roomkit.json의 server(${configured})와 로그인된 서버(${ctx.state.apiUrl})가 다릅니다. 테마 id가 다른 서버의 것일 수 있습니다.`,
    );
  }
}

export const CREATE_NEW = '__create__';

/** Interactive theme picker; with `allowCreate`, returns a sentinel Theme whose id is CREATE_NEW. */
export async function pickTheme(ctx: CliContext, message: string, allowCreate = false): Promise<Theme> {
  const themes = await listThemes(ctx);
  const choice = await select(ctx, ['--theme'], message, [
    ...themes.map((t) => ({ value: t.id, label: t.name, hint: t.id.slice(0, 8) })),
    ...(allowCreate ? [{ value: CREATE_NEW, label: '+ 새 테마 만들기' }] : []),
  ]);
  return themes.find((t) => t.id === choice) ?? ({ id: CREATE_NEW, name: '' } as Theme);
}
