import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import { zipSync } from 'fflate';
import { AssetSchema, SiteUploadResponseSchema } from '@roomkit/shared';
import { defineTool } from '../registry.js';
import { requireTheme, ToolError } from '../session.js';

const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
/** Kept from build output in errors/results — enough tail to diagnose. */
const OUTPUT_TAIL_CHARS = 4000;

/** OS noise the server's site import would skip anyway — don't ship it. */
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX']);

function runBuild(command: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BUILD_TIMEOUT_MS,
    });
    let output = '';
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-OUTPUT_TAIL_CHARS * 4);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (err) => {
      reject(new ToolError(`Could not run build command: ${err.message}`));
    });
    child.on('close', (code, signal) => {
      if (code === 0) resolve(output.slice(-OUTPUT_TAIL_CHARS));
      else {
        reject(
          new ToolError(
            `Build command failed (${signal ? `signal ${signal}` : `exit code ${code}`}): ${command}\n--- output tail ---\n${output.slice(-OUTPUT_TAIL_CHARS)}`,
          ),
        );
      }
    });
  });
}

/** Zips a directory's contents (no wrapping root folder) into one buffer. */
async function zipDirectory(root: string): Promise<{ zip: Uint8Array; files: string[] }> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const data: Record<string, Uint8Array> = {};
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (rel.split('/').some((seg) => JUNK_NAMES.has(seg))) continue;
    data[rel] = await readFile(abs);
    files.push(rel);
  }
  if (files.length === 0) {
    throw new ToolError(`Build output directory is empty: ${root}`);
  }
  if (!data['index.html']) {
    throw new ToolError(
      `Build output has no index.html at its root (${root}) — hosted websites are served starting from index.html. Check the build dest path.`,
    );
  }
  return { zip: zipSync(data), files };
}

export const deployTools = [
  defineTool({
    name: 'deploy_website',
    description:
      'Build a local web project and deploy the output as a hosted website asset: runs the build command in the build directory, zips the build dest (must contain index.html at its root), uploads it, and switches the asset to hosted mode serving the new files at {apiUrl}/api/sites/{assetId}/. The previous deployment stays in storage but is no longer referenced. Defaults to the selected theme.',
    inputSchema: z.object({
      themeId: z.uuid().optional(),
      websiteAssetId: z.uuid().describe('Existing asset of kind "website" to point at the new build'),
      buildDirectory: z.string().min(1).describe('Absolute path to the project to build (cwd for the build command)'),
      buildCommand: z.string().min(1).describe('Shell command that produces the build, e.g. "pnpm build"'),
      buildDest: z.string().min(1).describe('Build output directory, absolute or relative to buildDirectory, e.g. "dist"'),
    }),
    handler: async ({ themeId, websiteAssetId, buildDirectory, buildCommand, buildDest }, ctx) => {
      const resolvedThemeId = requireTheme(ctx.state, themeId);

      // Fail fast on a wrong asset id before spending time on the build.
      const asset = await ctx.api.api(
        `/themes/${resolvedThemeId}/assets/${websiteAssetId}`,
        { schema: AssetSchema },
      );
      if (asset.kind !== 'website') {
        throw new ToolError(
          `Asset ${websiteAssetId} ("${asset.name}") is kind "${asset.kind}", not "website".`,
        );
      }

      try {
        if (!(await stat(buildDirectory)).isDirectory()) {
          throw new ToolError(`buildDirectory is not a directory: ${buildDirectory}`);
        }
      } catch (err) {
        if (err instanceof ToolError) throw err;
        throw new ToolError(`Cannot access buildDirectory: ${buildDirectory}`);
      }

      const buildOutput = await runBuild(buildCommand, buildDirectory);

      const destPath = path.resolve(buildDirectory, buildDest);
      const { zip, files } = await zipDirectory(destPath);

      const form = new FormData();
      form.append('file', new Blob([zip], { type: 'application/zip' }), 'site.zip');
      const uploaded = await ctx.api.api(
        `/themes/${resolvedThemeId}/imports/site`,
        { method: 'POST', body: form, schema: SiteUploadResponseSchema },
      );

      await ctx.api.api(`/themes/${resolvedThemeId}/assets/${websiteAssetId}`, {
        method: 'PATCH',
        body: { data: { mode: 'hosted', sitePrefix: uploaded.sitePrefix } },
        schema: AssetSchema,
      });

      return {
        deployed: true,
        assetId: websiteAssetId,
        name: asset.name,
        fileCount: uploaded.fileCount,
        files: files.length <= 50 ? files : undefined,
        url: `${ctx.state.apiUrl}/api/sites/${websiteAssetId}/`,
        buildOutputTail: buildOutput || undefined,
      };
    },
  }),
];
