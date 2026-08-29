import { z } from 'zod';
import { AssetSchema, SessionSchema, ThemeSchema } from '@roomkit/shared';
import { CREDENTIALS_PATH, loadCredentials } from '../creds.js';
import { defineTool } from '../registry.js';
import { ToolError } from '../session.js';

export const connectionTools = [
  defineTool({
    name: 'login',
    description:
      `Connect to a RoomKit server and authenticate as admin. Successful credentials are saved to ${CREDENTIALS_PATH} and reused automatically (on process start and when the token expires), so normally you never need to call this or bother the user: only ask the user for credentials when a command failed because token expiration triggered a re-login that the saved credentials could not satisfy (or no credentials are saved yet). Call with no arguments to retry with the saved credentials; omitted fields fall back to the saved values. Never guess credentials.`,
    inputSchema: z.object({
      url: z.string().min(1).optional().describe('Server origin, e.g. http://localhost:3000 (with or without /api)'),
      id: z.string().min(1).optional().describe('Admin id'),
      password: z.string().min(1).optional().describe('Admin password'),
    }),
    handler: async ({ url, id, password }, ctx) => {
      const saved = loadCredentials();
      url ??= saved?.url;
      id ??= saved?.id;
      password ??= saved?.password;
      if (!url || !id || !password) {
        throw new ToolError(
          `No saved credentials at ${CREDENTIALS_PATH} — ask the user for the server URL, admin id, and password, then call login with all three.`,
        );
      }
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
        try {
          await ctx.api.ensureLogin();
        } catch (err) {
          return {
            loggedIn: false,
            note: err instanceof Error ? err.message : String(err),
          };
        }
      }
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
