import { z } from 'zod';
import {
  CreateThemeInputSchema,
  ThemeSchema,
  UpdateThemeInputSchema,
} from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme } from '../session.js';

export const themeTools = [
  defineTool({
    name: 'list_themes',
    description: 'List all themes (escape-room titles) on the server.',
    inputSchema: z.object({}),
    handler: (_input, ctx) => ctx.api.api('/themes', { schema: z.array(ThemeSchema) }),
  }),

  defineTool({
    name: 'create_theme',
    description:
      'Create a theme. timeLimitMs is the countdown time limit in milliseconds (null/omitted = no timer). Usually follow up with select_theme.',
    inputSchema: CreateThemeInputSchema,
    handler: (input, ctx) =>
      ctx.api.api('/themes', { method: 'POST', body: input, schema: ThemeSchema }),
  }),

  defineTool({
    name: 'update_theme',
    description: 'Update a theme\'s name and/or timeLimitMs. Defaults to the selected theme.',
    inputSchema: UpdateThemeInputSchema.extend({ themeId: z.uuid().optional() }),
    handler: ({ themeId, ...input }, ctx) =>
      ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}`, {
        method: 'PATCH',
        body: input,
        schema: ThemeSchema,
      }),
  }),

  defineTool({
    name: 'delete_theme',
    description:
      'PERMANENTLY delete a theme and all its assets and sessions. Requires an explicit themeId (never defaults to the selection). Confirm with the user unless you created the theme yourself in this conversation.',
    inputSchema: z.object({ themeId: z.uuid() }),
    handler: async ({ themeId }, ctx) => {
      await ctx.api.api(`/themes/${themeId}`, { method: 'DELETE' });
      if (ctx.state.selectedTheme?.id === themeId) ctx.state.selectedTheme = null;
      return { deleted: themeId };
    },
  }),

  defineTool({
    name: 'duplicate_theme',
    description:
      'Deep-copy a theme: all assets/tags with cross-references remapped (files are shared, not copied). Defaults to the selected theme as the source.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      name: z.string().min(1).optional().describe('Name for the copy'),
    }),
    handler: ({ themeId, name }, ctx) =>
      ctx.api.api(`/themes/${requireTheme(ctx.state, themeId)}/duplicate`, {
        method: 'POST',
        body: name ? { name } : {},
        schema: ThemeSchema,
      }),
  }),
];
