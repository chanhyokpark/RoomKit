import { spawn } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { zipSync } from 'fflate';
import { AssetSchema, SiteUploadResponseSchema } from '@roomkit/shared';
import type { OpsContext } from '../context.js';
import { ThemeIndex } from '../refs.js';
import { ToolError } from '../session.js';

const BUILD_TIMEOUT_MS = 10 * 60 * 1000;
/** Kept from build output in errors/results — enough tail to diagnose. */
const OUTPUT_TAIL_CHARS = 4000;

/** OS noise the server's site import would skip anyway — don't ship it. */
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX']);

export interface BuildOptions {
  /** Receives raw build output chunks as they arrive (TTY progress). */
  onOutput?: (chunk: string) => void;
}

export function runBuild(command: string, cwd: string, opts: BuildOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BUILD_TIMEOUT_MS,
    });
    let output = '';
    const append = (chunk: Buffer) => {
      const text = chunk.toString();
      output = (output + text).slice(-OUTPUT_TAIL_CHARS * 4);
      opts.onOutput?.(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (err) => {
      reject(new ToolError(`Could not run build command: ${err.message}`, 'build_failed'));
    });
    child.on('close', (code, signal) => {
      if (code === 0) resolve(output.slice(-OUTPUT_TAIL_CHARS));
      else {
        reject(
          new ToolError(
            `Build command failed (${signal ? `signal ${signal}` : `exit code ${code}`}): ${command}\n--- output tail ---\n${output.slice(-OUTPUT_TAIL_CHARS)}`,
            'build_failed',
          ),
        );
      }
    });
  });
}

/** Zips a directory's contents (no wrapping root folder) into one buffer. */
export async function zipDirectory(root: string): Promise<{ zip: Uint8Array; files: string[] }> {
  let entries;
  try {
    entries = await readdir(root, { recursive: true, withFileTypes: true });
  } catch {
    throw new ToolError(`Build output directory does not exist: ${root}`, 'not_found');
  }
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
    throw new ToolError(`Build output directory is empty: ${root}`, 'not_found');
  }
  if (!data['index.html']) {
    throw new ToolError(
      `Build output has no index.html at its root (${root}) — hosted websites are served starting from index.html. Check the dist path.`,
      'no_index',
    );
  }
  return { zip: zipSync(data), files };
}

export interface DeployWebsiteInput {
  themeId: string;
  /** Website asset reference (uuid, key, or name). */
  websiteRef: string;
  /** Project directory (cwd for the build command). */
  buildDirectory: string;
  /** Shell command producing the build; null/undefined skips the build. */
  buildCommand?: string | null;
  /** Build output directory, absolute or relative to buildDirectory. */
  buildDest: string;
  onOutput?: (chunk: string) => void;
  /** Called between stages so callers can show progress. */
  onStage?: (stage: 'build' | 'zip' | 'upload' | 'switch') => void;
}

export interface DeployResult {
  deployed: true;
  assetId: string;
  name: string;
  key: string | null;
  fileCount: number;
  files?: string[];
  url: string;
  buildOutputTail?: string;
}

/**
 * Build a local web project and deploy the output as a hosted website asset:
 * build → zip the dest (must contain index.html at its root) → upload →
 * switch the asset to hosted mode serving the new files at
 * {apiUrl}/api/sites/{assetId}/. The previous deployment stays in storage.
 */
export async function deployWebsite(ctx: OpsContext, input: DeployWebsiteInput): Promise<DeployResult> {
  const { themeId, buildDirectory, buildCommand, buildDest } = input;

  // Fail fast on a wrong asset reference before spending time on the build.
  const index = await ThemeIndex.load(ctx, themeId);
  const asset = index.resolveAsset(input.websiteRef, 'website', 'website');
  if (!index.get(asset.id)) {
    throw new ToolError(`No website asset with id ${asset.id} in this theme.`, 'not_found');
  }

  try {
    if (!(await stat(buildDirectory)).isDirectory()) {
      throw new ToolError(`Not a directory: ${buildDirectory}`, 'not_found');
    }
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError(`Cannot access directory: ${buildDirectory}`, 'not_found');
  }

  let buildOutput = '';
  if (buildCommand) {
    input.onStage?.('build');
    buildOutput = await runBuild(buildCommand, buildDirectory, { onOutput: input.onOutput });
  }

  input.onStage?.('zip');
  const destPath = path.resolve(buildDirectory, buildDest);
  const { zip, files } = await zipDirectory(destPath);

  input.onStage?.('upload');
  const form = new FormData();
  form.append('file', new Blob([zip], { type: 'application/zip' }), 'site.zip');
  const uploaded = await ctx.api.api(`/themes/${themeId}/imports/site`, {
    method: 'POST',
    body: form,
    schema: SiteUploadResponseSchema,
  });

  input.onStage?.('switch');
  await ctx.api.api(`/themes/${themeId}/assets/${asset.id}`, {
    method: 'PATCH',
    body: { data: { mode: 'hosted', sitePrefix: uploaded.sitePrefix } },
    schema: AssetSchema,
  });

  return {
    deployed: true,
    assetId: asset.id,
    name: asset.name,
    key: asset.key,
    fileCount: uploaded.fileCount,
    files: files.length <= 50 ? files : undefined,
    url: siteUrl(ctx, asset.id),
    buildOutputTail: buildOutput || undefined,
  };
}

export function siteUrl(ctx: OpsContext, assetId: string): string {
  return `${ctx.state.apiUrl}/api/sites/${assetId}/`;
}
