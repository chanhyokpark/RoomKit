import { z } from 'zod';
import { TagSchema } from '@roomkit/shared';
import { resolveThemeId, TagRefSchema, ThemeIndex, ThemeRefSchema } from '../refs.js';
import { defineTool } from '../registry.js';
import { ToolError } from '../session.js';

export const tagTools = [
  defineTool({
    name: 'list_tags',
    description: 'List the theme\'s asset tags. Defaults to the selected theme.',
    inputSchema: z.object({ themeId: ThemeRefSchema.optional() }),
    handler: async ({ themeId }, ctx) =>
      ctx.api.api(`/themes/${await resolveThemeId(ctx, themeId)}/tags`, {
        schema: z.array(TagSchema),
      }),
  }),

  defineTool({
    name: 'manage_tag',
    description:
      'Create, update, or delete an asset tag. create needs name+color (any CSS color); update/delete need tagId (uuid or current name). Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: ThemeRefSchema.optional(),
      action: z.enum(['create', 'update', 'delete']),
      tagId: TagRefSchema.optional(),
      name: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
    }),
    handler: async ({ themeId, action, tagId, name, color }, ctx) => {
      const resolvedThemeId = await resolveThemeId(ctx, themeId);
      const base = `/themes/${resolvedThemeId}/tags`;
      if (action === 'create') {
        if (!name || !color) throw new ToolError('create needs name and color.');
        return ctx.api.api(base, { method: 'POST', body: { name, color }, schema: TagSchema });
      }
      if (!tagId) throw new ToolError(`${action} needs tagId.`);
      tagId = (await new ThemeIndex(ctx, resolvedThemeId, []).resolveTagIds([tagId]))![0]!;
      if (action === 'delete') {
        await ctx.api.api(`${base}/${tagId}`, { method: 'DELETE' });
        return { deleted: tagId };
      }
      return ctx.api.api(`${base}/${tagId}`, {
        method: 'PATCH',
        body: { ...(name && { name }), ...(color && { color }) },
        schema: TagSchema,
      });
    },
  }),
];
