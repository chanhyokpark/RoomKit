import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import mime from 'mime-types';
import { PresignUploadResponseSchema } from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme, ToolError } from '../session.js';

export const uploadTools = [
  defineTool({
    name: 'upload_file',
    description:
      'Upload a local file (absolute path) to the theme\'s media storage. Returns the storage `key` to persist as fileKey/imageKey in asset data (bgm/sfx/video/image/file assets, dialogue lines, hint step images). Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      filePath: z.string().min(1).describe('Absolute path to a local file'),
      contentType: z.string().min(1).optional().describe('Defaults to a guess from the file extension'),
    }),
    handler: async ({ themeId, filePath, contentType }, ctx) => {
      const resolvedThemeId = requireTheme(ctx.state, themeId);
      let size: number;
      try {
        size = (await stat(filePath)).size;
      } catch {
        throw new ToolError(`Cannot read file: ${filePath}`);
      }
      const type = contentType ?? (mime.lookup(filePath) || 'application/octet-stream');

      const { key, url } = await ctx.api.api(`/themes/${resolvedThemeId}/uploads`, {
        method: 'POST',
        body: { filename: basename(filePath), contentType: type },
        schema: PresignUploadResponseSchema,
      });

      // Content-Type must exactly match what was signed.
      const body = await readFile(filePath);
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': type },
        body,
      });
      if (!res.ok) {
        throw new ToolError(`Storage upload failed (${res.status} ${res.statusText}).`);
      }
      return { key, size, contentType: type };
    },
  }),

  defineTool({
    name: 'get_file_url',
    description:
      'Get a temporary download URL (expires in ~600s) for a storage key from asset data. For image/file assets the stable public URL {apiUrl}/api/media/{assetId} is usually better.',
    inputSchema: z.object({ key: z.string().min(1) }),
    handler: ({ key }, ctx) =>
      ctx.api.api('/files/url', { query: { key }, schema: z.object({ url: z.string() }) }),
  }),
];
