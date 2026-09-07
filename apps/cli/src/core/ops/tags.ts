import { z } from 'zod';
import { TagSchema, type Tag } from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { matchTag } from '../refs.js';

export function listTags(ctx: OpsContext, themeId: string): Promise<Tag[]> {
  return ctx.api.api(`/themes/${themeId}/tags`, { schema: z.array(TagSchema) });
}

export async function findTag(ctx: OpsContext, themeId: string, ref: string): Promise<Tag> {
  return matchTag(await listTags(ctx, themeId), ref);
}

export function createTag(ctx: OpsContext, themeId: string, name: string, color: string): Promise<Tag> {
  return ctx.api.api(`/themes/${themeId}/tags`, { method: 'POST', body: { name, color }, schema: TagSchema });
}

export async function updateTag(
  ctx: OpsContext,
  themeId: string,
  ref: string,
  patch: { name?: string; color?: string },
): Promise<Tag> {
  const tag = await findTag(ctx, themeId, ref);
  return ctx.api.api(`/themes/${themeId}/tags/${tag.id}`, {
    method: 'PATCH',
    body: { ...(patch.name && { name: patch.name }), ...(patch.color && { color: patch.color }) },
    schema: TagSchema,
  });
}

export async function deleteTag(ctx: OpsContext, themeId: string, ref: string): Promise<Tag> {
  const tag = await findTag(ctx, themeId, ref);
  await ctx.api.api(`/themes/${themeId}/tags/${tag.id}`, { method: 'DELETE' });
  return tag;
}
