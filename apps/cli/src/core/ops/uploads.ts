import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { z } from 'zod';
import mime from 'mime-types';
import { PresignUploadResponseSchema } from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { ToolError } from '../session.js';

export interface UploadResult {
  key: string;
  size: number;
  contentType: string;
}

/** Upload one local file to the theme's media storage via presigned PUT. */
export async function uploadFile(
  ctx: OpsContext,
  themeId: string,
  filePath: string,
  contentType?: string,
): Promise<UploadResult> {
  let size: number;
  try {
    size = (await stat(filePath)).size;
  } catch {
    throw new ToolError(`Cannot read file: ${filePath}`, 'not_found');
  }
  const type = contentType ?? (mime.lookup(filePath) || 'application/octet-stream');

  const { key, url } = await ctx.api.api(`/themes/${themeId}/uploads`, {
    method: 'POST',
    body: { filename: basename(filePath), contentType: type },
    schema: PresignUploadResponseSchema,
  });

  // Content-Type must exactly match what was signed.
  const body = await readFile(filePath);
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': type }, body });
  if (!res.ok) {
    throw new ToolError(`Storage upload failed (${res.status} ${res.statusText}).`, 'upload_failed');
  }
  return { key, size, contentType: type };
}

/** Temporary (~600s) download URL for a storage key. */
export function getFileUrl(ctx: OpsContext, key: string): Promise<{ url: string }> {
  return ctx.api.api('/files/url', { query: { key }, schema: z.object({ url: z.string() }) });
}
