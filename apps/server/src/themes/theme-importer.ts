import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  assetDataSchemas,
  ThemeExportManifestSchema,
  type ThemeExportManifest,
} from '@roomkit/shared';
import * as mime from 'mime-types';
import { z } from 'zod';
import { Prisma, type Theme } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  collectFileRefs,
  isUuid,
  remapManifestData,
  rewriteFileRefs,
  UnknownRefError,
} from './asset-data-refs';
import {
  forEachZipEntry,
  isDirectoryEntry,
  junkReason,
  openZip,
  openZipEntryStream,
} from '../zip-imports/zip-utils';

/** Zip-bomb guards. Higher entry cap than media imports: a theme archive
 * legitimately contains every media file plus whole hosted sites. */
const MAX_ENTRIES = 10_000;
const MAX_TOTAL_UNCOMPRESSED = 8 * 1024 ** 3;
const MAX_MANIFEST_BYTES = 64 * 1024 ** 2;

const FILES_PREFIX = 'files/';

function sanitizeFilename(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'file';
}

function isUniqueViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
  );
}

/**
 * Recreates a theme from a ThemeExporter archive: fresh theme/tag/asset ids
 * with cross-asset references remapped (like duplication), and every archived
 * file re-uploaded under keys owned by the new theme. A referenced file
 * missing from the archive imports as a placeholder (null fileKey/imageKey).
 *
 * Manifest ids may be any manifest-unique string, not just uuids — hand-written
 * manifests can use readable ids ("door-device") and omit identity-only uuids
 * (dialogue line / sequence entry ids). References are remapped to the fresh
 * uuids BEFORE per-kind validation so the strict schemas see valid ids.
 *
 * Files upload before the DB transaction; a failed import deletes the theme
 * row but leaves the uploaded objects — consistent with the S3 no-delete
 * policy (see ThemeDuplicator).
 */
@Injectable()
export class ThemeImporter {
  private readonly logger = new Logger(ThemeImporter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async import(zipPath: string): Promise<Theme> {
    const manifest = await this.readManifest(zipPath);

    // Fresh database ids, minted up front; manifest ids only wire references.
    const newAssetIds = manifest.assets.map(() => randomUUID());
    const newTagIds = manifest.tags.map(() => randomUUID());
    const assetIdMap = buildIdMap(manifest.assets, newAssetIds, 'asset');
    const tagIdMap = buildIdMap(manifest.tags, newTagIds, 'tag');

    const dataByIndex = manifest.assets.map((asset) =>
      this.remapAndValidate(asset, assetIdMap, tagIdMap),
    );

    // File refs from the validated data — what the archive should contain.
    const refKeys = new Set<string>();
    const refPrefixes = new Set<string>();
    for (const [i, asset] of manifest.assets.entries()) {
      const refs = collectFileRefs(asset.kind, dataByIndex[i]);
      for (const key of refs.keys) refKeys.add(key);
      for (const prefix of refs.sitePrefixes) refPrefixes.add(prefix);
    }

    const theme = await this.prisma.theme.create({
      data: {
        name: manifest.theme.name,
        timeLimitMs: manifest.theme.timeLimitMs,
      },
    });
    try {
      const { keyMap, prefixMap } = await this.uploadFiles(
        zipPath,
        theme.id,
        refKeys,
        refPrefixes,
      );
      await this.createRows(theme.id, manifest, {
        dataByIndex,
        newAssetIds,
        newTagIds,
        tagIdMap,
        keyMap,
        prefixMap,
      });
      return theme;
    } catch (err) {
      // Roll back the half-imported theme; uploaded S3 objects stay (harmless).
      await this.prisma.theme
        .delete({ where: { id: theme.id } })
        .catch((cleanupErr) =>
          this.logger.error(
            `Failed to clean up theme ${theme.id}: ${String(cleanupErr)}`,
          ),
        );
      throw err;
    }
  }

  /** Pass 1: locate and parse manifest.json, enforcing zip-bomb guards. */
  private async readManifest(zipPath: string): Promise<ThemeExportManifest> {
    let raw: Buffer | null = null;
    const zipfile = await openZip(zipPath);
    if (zipfile.entryCount > MAX_ENTRIES) {
      zipfile.close();
      throw new BadRequestException(
        `Zip has too many entries (max ${MAX_ENTRIES})`,
      );
    }
    let totalSize = 0;
    await forEachZipEntry(zipfile, async (entry) => {
      if (isDirectoryEntry(entry) || junkReason(entry.fileName)) return;
      totalSize += entry.uncompressedSize;
      if (totalSize > MAX_TOTAL_UNCOMPRESSED) {
        throw new BadRequestException(
          'Zip uncompressed size exceeds the limit',
        );
      }
      if (entry.fileName === 'manifest.json') {
        if (entry.uncompressedSize > MAX_MANIFEST_BYTES) {
          throw new BadRequestException('manifest.json is too large');
        }
        raw = await readAll(await openZipEntryStream(zipfile, entry));
      }
    });
    if (!raw) {
      throw new BadRequestException(
        'Not a theme archive: manifest.json is missing',
      );
    }

    let json: unknown;
    try {
      json = JSON.parse((raw as Buffer).toString('utf8'));
    } catch {
      throw new BadRequestException('manifest.json is not valid JSON');
    }
    const parsed = ThemeExportManifestSchema.safeParse(json);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Invalid theme manifest',
        errors: z.treeifyError(parsed.error as z.ZodError<unknown>),
      });
    }
    return parsed.data;
  }

  /**
   * Remaps manifest-id references to the fresh uuids, then validates strictly
   * per kind — the archive is untrusted input. An unknown non-uuid reference
   * is a hand-editing typo and fails loudly; unknown uuids keep the tolerant
   * dangling-ref semantics of duplication.
   */
  private remapAndValidate(
    asset: ThemeExportManifest['assets'][number],
    assetIdMap: Map<string, string>,
    tagIdMap: Map<string, string>,
  ): Prisma.InputJsonValue {
    for (const tagId of asset.tagIds) {
      if (!tagIdMap.has(tagId) && !isUuid(tagId)) {
        throw new BadRequestException(
          `Unknown tag reference "${tagId}" in asset "${asset.name}"`,
        );
      }
    }

    let remapped: unknown;
    try {
      remapped = remapManifestData(asset.kind, asset.data, assetIdMap);
    } catch (err) {
      if (err instanceof UnknownRefError) {
        throw new BadRequestException(
          `Unknown asset reference "${err.ref}" in asset "${asset.name}"`,
        );
      }
      throw err;
    }

    const parsed = assetDataSchemas[asset.kind].safeParse(remapped);
    if (!parsed.success) {
      throw new BadRequestException({
        message: `Invalid data for asset "${asset.name}" (${asset.kind})`,
        errors: z.treeifyError(parsed.error as z.ZodError<unknown>),
      });
    }
    return parsed.data;
  }

  /**
   * Pass 2: upload every referenced files/<key> entry under a key owned by
   * the new theme. Site entries keep their path relative to the (fresh)
   * prefix; other files get the media upload key shape.
   */
  private async uploadFiles(
    zipPath: string,
    themeId: string,
    refKeys: Set<string>,
    refPrefixes: Set<string>,
  ): Promise<{
    keyMap: Map<string, string>;
    prefixMap: Map<string, string>;
  }> {
    const keyMap = new Map<string, string>();
    const prefixMap = new Map<string, string>();
    for (const prefix of refPrefixes) {
      prefixMap.set(prefix, `sites/${themeId}/${randomUUID()}`);
    }

    const zipfile = await openZip(zipPath);
    await forEachZipEntry(zipfile, async (entry) => {
      if (isDirectoryEntry(entry) || junkReason(entry.fileName)) return;
      if (!entry.fileName.startsWith(FILES_PREFIX)) return;
      const key = entry.fileName.slice(FILES_PREFIX.length);

      let newKey: string | undefined;
      for (const [prefix, newPrefix] of prefixMap) {
        if (key.startsWith(`${prefix}/`)) {
          newKey = `${newPrefix}/${key.slice(prefix.length + 1)}`;
          break;
        }
      }
      if (!newKey && refKeys.has(key) && !keyMap.has(key)) {
        newKey = `themes/${themeId}/${randomUUID()}/${sanitizeFilename(key)}`;
        keyMap.set(key, newKey);
      }
      // Entries nothing references are ignored.
      if (!newKey) return;

      const stream = await openZipEntryStream(zipfile, entry);
      await this.storage.putStream(
        newKey,
        stream,
        mime.lookup(key) || 'application/octet-stream',
      );
    });
    return { keyMap, prefixMap };
  }

  private async createRows(
    themeId: string,
    manifest: ThemeExportManifest,
    ctx: {
      /** Remapped + validated data, aligned with manifest.assets. */
      dataByIndex: Prisma.InputJsonValue[];
      newAssetIds: string[];
      newTagIds: string[];
      tagIdMap: Map<string, string>;
      keyMap: Map<string, string>;
      prefixMap: Map<string, string>;
    },
  ): Promise<void> {
    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (manifest.tags.length > 0) {
            await tx.tag.createMany({
              data: manifest.tags.map((tag, i) => ({
                id: ctx.newTagIds[i],
                themeId,
                name: tag.name,
                color: tag.color,
              })),
            });
          }
          for (const [i, asset] of manifest.assets.entries()) {
            await tx.asset.create({
              data: {
                id: ctx.newAssetIds[i],
                themeId,
                kind: asset.kind,
                name: asset.name,
                description: asset.description,
                code: asset.code,
                data: rewriteFileRefs(
                  asset.kind,
                  ctx.dataByIndex[i],
                  ctx.keyMap,
                  ctx.prefixMap,
                ),
                tags: {
                  // Unknown uuid tag refs are dropped (dangling tolerance);
                  // unknown non-uuid refs already failed validation.
                  connect: asset.tagIds
                    .filter((id) => ctx.tagIdMap.has(id))
                    .map((id) => ({ id: ctx.tagIdMap.get(id)! })),
                },
              },
            });
          }
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new BadRequestException(
          'Manifest contains duplicate tag names or asset codes',
        );
      }
      throw err;
    }
  }
}

/** Manifest id → fresh uuid; entries without an id are simply unreferenceable. */
function buildIdMap(
  items: readonly { id?: string }[],
  newIds: string[],
  kindLabel: 'asset' | 'tag',
): Map<string, string> {
  const map = new Map<string, string>();
  items.forEach((item, i) => {
    if (item.id === undefined) return;
    if (map.has(item.id)) {
      throw new BadRequestException(
        `Manifest contains duplicate ${kindLabel} id "${item.id}"`,
      );
    }
    map.set(item.id, newIds[i]);
  });
  return map;
}

function readAll(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
