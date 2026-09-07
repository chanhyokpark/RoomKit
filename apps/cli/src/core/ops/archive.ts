import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { BulkUploadResultSchema, ThemeSchema, type BulkUploadKind, type BulkUploadResult, type Theme } from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { ToolError } from '../session.js';

/** Download a theme archive (zip) to `destPath`. */
export async function exportTheme(ctx: OpsContext, themeId: string, destPath: string): Promise<{ path: string; bytes: number }> {
  const res = await ctx.api.download(`/themes/${themeId}/export`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(destPath, bytes);
  return { path: destPath, bytes: bytes.byteLength };
}

async function readZip(zipPath: string): Promise<Blob> {
  let data: Buffer;
  try {
    data = await readFile(zipPath);
  } catch {
    throw new ToolError(`Cannot read file: ${zipPath}`, 'not_found');
  }
  return new Blob([data], { type: 'application/zip' });
}

/** Import a theme archive as a new theme. */
export async function importTheme(ctx: OpsContext, zipPath: string): Promise<Theme> {
  const form = new FormData();
  form.append('file', await readZip(zipPath), basename(zipPath));
  return ctx.api.api('/themes/import', { method: 'POST', body: form, schema: ThemeSchema });
}

/** Bulk-create media assets (bgm/sfx/video/dialogue) from a zip of files. */
export async function importMedia(
  ctx: OpsContext,
  themeId: string,
  kind: BulkUploadKind,
  zipPath: string,
): Promise<BulkUploadResult> {
  const form = new FormData();
  form.append('file', await readZip(zipPath), basename(zipPath));
  return ctx.api.api(`/themes/${themeId}/imports/${kind}`, {
    method: 'POST',
    body: form,
    schema: BulkUploadResultSchema,
  });
}
