import { z } from 'zod';
import { TagSchema } from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme, ToolError } from '../session.js';

export const tagTools = [
  defineTool({
    name: 'list_tags',
    description: 'List the theme\'s asset tags. Defaults to the selected theme.',
    inputSchema: z.object({ themeId: z.uuid().optional() }),
    handler: ({ themeId }, ctx) =>
      ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}/tags`, {
        schema: z.array(TagSchema),
      }),
  }),

  defineTool({
    name: 'manage_tag',
    description:
      'Create, update, or delete an asset tag. create needs name+color (any CSS color); update/delete need tagId. Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      action: z.enum(['create', 'update', 'delete']),
      tagId: z.uuid().optional(),
      name: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
    }),
    handler: async ({ themeId, action, tagId, name, color }, ctx) => {
      const base = `/themes/${requireTheme(ctx.state, themeId)}/tags`;
      if (action === 'create') {
        if (!name || !color) throw new ToolError('create needs name and color.');
        return ctx.api.api(base, { method: 'POST', body: { name, color }, schema: TagSchema });
      }
      if (!tagId) throw new ToolError(`${action} needs tagId.`);
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
