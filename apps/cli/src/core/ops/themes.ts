import { z } from 'zod';
import { CreateThemeInputSchema, ThemeSchema, UpdateThemeInputSchema, type Theme } from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { matchTheme } from '../refs.js';

export type CreateThemeInput = z.infer<typeof CreateThemeInputSchema>;
export type UpdateThemeInput = z.infer<typeof UpdateThemeInputSchema>;

export function listThemes(ctx: OpsContext): Promise<Theme[]> {
  return ctx.api.api('/themes', { schema: z.array(ThemeSchema) });
}

/** uuid or name → Theme (throws with candidates when unknown/ambiguous). */
export async function findTheme(ctx: OpsContext, ref: string): Promise<Theme> {
  return matchTheme(await listThemes(ctx), ref);
}

export function getTheme(ctx: OpsContext, themeId: string): Promise<Theme> {
  return ctx.api.api(`/themes/${themeId}`, { schema: ThemeSchema });
}

export function createTheme(ctx: OpsContext, input: CreateThemeInput): Promise<Theme> {
  return ctx.api.api('/themes', { method: 'POST', body: CreateThemeInputSchema.parse(input), schema: ThemeSchema });
}

export function updateTheme(ctx: OpsContext, themeId: string, input: UpdateThemeInput): Promise<Theme> {
  return ctx.api.api(`/themes/${themeId}`, {
    method: 'PATCH',
    body: UpdateThemeInputSchema.parse(input),
    schema: ThemeSchema,
  });
}

export async function deleteTheme(ctx: OpsContext, themeId: string): Promise<void> {
  await ctx.api.api(`/themes/${themeId}`, { method: 'DELETE' });
}

export function duplicateTheme(ctx: OpsContext, themeId: string, name?: string): Promise<Theme> {
  return ctx.api.api(`/themes/${themeId}/duplicate`, {
    method: 'POST',
    body: name ? { name } : {},
    schema: ThemeSchema,
  });
}
