import { z } from 'zod';
import { AssetSchema, SessionSchema, ThemeSchema } from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireLogin, ToolError } from '../session.js';

export const connectionTools = [
  defineTool({
    name: 'login',
    description:
      'Connect to a RoomKit server and authenticate as admin. Must be called before any other tool. Ask the user for the server URL (e.g. http://localhost:3000), admin id, and password — never guess credentials. Credentials are kept in memory only, for automatic re-login when the token expires.',
    inputSchema: z.object({
      url: z.string().min(1).describe('Server origin, e.g. http://localhost:3000 (with or without /api)'),
      id: z.string().min(1).describe('Admin id'),
      password: z.string().min(1).describe('Admin password'),
    }),
    handler: async ({ url, id, password }, ctx) => {
      await ctx.api.login(url, id, password);
      const themes = await ctx.api.api('/themes', { schema: z.array(ThemeSchema) });
      return {
        loggedIn: true,
        apiUrl: ctx.state.apiUrl,
        themes: themes.map((t) => ({ id: t.id, name: t.name })),
        next: themes.length
          ? 'Call select_theme to pick a theme, or create_theme to start a new one.'
          : 'No themes yet — call create_theme to start one.',
      };
    },
  }),

  defineTool({
    name: 'select_theme',
    description:
      'Set the active theme for this conversation. All theme-scoped tools (assets, sequences, sessions, ...) default to it, so themeId never needs repeating. Pass either the theme id or its name. Returns a summary with asset counts per kind.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      name: z.string().min(1).optional().describe('Theme name (exact, or unique case-insensitive match)'),
    }),
    handler: async ({ themeId, name }, ctx) => {
      if (!themeId && !name) throw new ToolError('Pass themeId or name.');
      const themes = await ctx.api.api('/themes', { schema: z.array(ThemeSchema) });
      let theme = themeId ? themes.find((t) => t.id === themeId) : undefined;
      if (!theme && name) {
        theme = themes.find((t) => t.name === name);
        if (!theme) {
          const matches = themes.filter((t) => t.name.toLowerCase().includes(name.toLowerCase()));
          if (matches.length === 1) theme = matches[0];
          else if (matches.length > 1) {
            throw new ToolError(
              `Theme name "${name}" is ambiguous: ${matches.map((t) => t.name).join(', ')}`,
            );
          }
        }
      }
      if (!theme) {
        throw new ToolError(
          `Theme not found. Available: ${themes.map((t) => `${t.name} (${t.id})`).join(', ') || '(none)'}`,
        );
      }
      ctx.state.selectedTheme = { id: theme.id, name: theme.name };
      const assets = await ctx.api.api(`/themes/${theme.id}/assets`, {
        schema: z.array(AssetSchema),
      });
      const assetCounts: Record<string, number> = {};
      for (const asset of assets) assetCounts[asset.kind] = (assetCounts[asset.kind] ?? 0) + 1;
      return { selected: theme, assetCounts };
    },
  }),

  defineTool({
    name: 'get_context',
    description:
      'Current MCP session state: login target, selected theme, connected virtual devices, and active (non-ended) sessions. Cheap re-orientation for a resumed conversation.',
    inputSchema: z.object({}),
    handler: async (_input, ctx) => {
      const { state } = ctx;
      if (!state.apiUrl) {
        return { loggedIn: false, note: 'Call login first (ask the user for URL/id/password).' };
      }
      requireLogin(state);
      const activeSessions = await ctx.api.api('/sessions', {
        query: { active: 'true', themeId: state.selectedTheme?.id },
        schema: z.array(SessionSchema),
      });
      return {
        loggedIn: true,
        apiUrl: state.apiUrl,
        adminId: state.adminId,
        selectedTheme: state.selectedTheme,
        virtualDevices: ctx.devices.states(),
        activeSessions,
      };
    },
  }),
];
