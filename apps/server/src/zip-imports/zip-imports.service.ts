import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  PLACEHOLDER_DURATION_DEFAULTS,
  type BulkUploadKind,
  type BulkUploadResult,
  type SiteUploadResponse,
} from '@roomkit/shared';
import * as mime from 'mime-types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import {
  forEachZipEntry,
  isDirectoryEntry,
  junkReason,
  openZip,
  openZipEntryStream,
} from './zip-utils';

/** Zip-bomb guards. */
const MAX_ENTRIES = 2000;
const MAX_TOTAL_UNCOMPRESSED = 8 * 1024 ** 3;

const AUDIO_EXTENSIONS = [
  '.mp3',
  '.wav',
  '.ogg',
  '.m4a',
  '.aac',
  '.flac',
  '.webm',
];
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv'];

const KIND_EXTENSIONS: Record<BulkUploadKind, string[]> = {
  bgm: AUDIO_EXTENSIONS,
  sfx: AUDIO_EXTENSIONS,
  dialogue: AUDIO_EXTENSIONS,
  video: VIDEO_EXTENSIONS,
};

/** `aaaa_2` → group "aaaa", order 2. No suffix → its own single-line group. */
const DIALOGUE_SUFFIX = /^(.*)_(\d+)$/;

function sanitizeFilename(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'file';
}

interface UploadedEntry {
  /** Zip entry path, for the result report. */
  entryPath: string;
  /** Basename without extension — becomes the asset (or group) name. */
  baseName: string;
  fileKey: string;
}

@Injectable()
export class ZipImportsService {
  private readonly logger = new Logger(ZipImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Extracts media files from the zip to S3 and creates one asset per file (or dialogue group). */
  async importMedia(
    themeId: string,
    kind: BulkUploadKind,
    zipPath: string,
  ): Promise<BulkUploadResult> {
    const allowed = KIND_EXTENSIONS[kind];
    const uploaded: UploadedEntry[] = [];
    const skipped: BulkUploadResult['skipped'] = [];

    const zipfile = await openZip(zipPath);
    this.guardEntryCount(zipfile.entryCount);
    let totalSize = 0;

    await forEachZipEntry(zipfile, async (entry) => {
      if (isDirectoryEntry(entry)) return;
      const junk = junkReason(entry.fileName);
      if (junk) {
        skipped.push({ file: entry.fileName, reason: junk });
        return;
      }
      const ext = path.extname(entry.fileName).toLowerCase();
      if (!allowed.includes(ext)) {
        skipped.push({
          file: entry.fileName,
          reason: `unsupported extension for ${kind}`,
        });
        return;
      }
      totalSize += entry.uncompressedSize;
      this.guardTotalSize(totalSize);

      const fileKey = `themes/${themeId}/${randomUUID()}/${sanitizeFilename(entry.fileName)}`;
      try {
        const stream = await openZipEntryStream(zipfile, entry);
        await this.storage.putStream(
          fileKey,
          stream,
          mime.lookup(entry.fileName) || 'application/octet-stream',
        );
        uploaded.push({
          entryPath: entry.fileName,
          baseName: path.basename(entry.fileName, ext),
          fileKey,
        });
      } catch (err) {
        // Always-create semantics: a failed file skips, the rest continue.
        this.logger.warn(`Failed to extract ${entry.fileName}: ${String(err)}`);
        skipped.push({ file: entry.fileName, reason: 'extraction failed' });
      }
    });

    const created =
      kind === 'dialogue'
        ? await this.createDialogueAssets(themeId, uploaded)
        : await this.createMediaAssets(themeId, kind, uploaded);
    return { created, skipped };
  }

  private async createMediaAssets(
    themeId: string,
    kind: Exclude<BulkUploadKind, 'dialogue'>,
    uploaded: UploadedEntry[],
  ): Promise<BulkUploadResult['created']> {
    const created: BulkUploadResult['created'] = [];
    for (const file of uploaded) {
      const asset = await this.prisma.asset.create({
        data: {
          themeId,
          kind,
          name: file.baseName,
          data: {
            fileKey: file.fileKey,
            durationMs: PLACEHOLDER_DURATION_DEFAULTS[kind],
          },
        },
      });
      created.push({
        assetId: asset.id,
        name: asset.name,
        files: [file.entryPath],
      });
    }
    return created;
  }

  private async createDialogueAssets(
    themeId: string,
    uploaded: UploadedEntry[],
  ): Promise<BulkUploadResult['created']> {
    // Group `name_N` files into one dialogue ordered by N; others stand alone.
    const groups = new Map<string, { order: number; file: UploadedEntry }[]>();
    for (const file of uploaded) {
      const match = DIALOGUE_SUFFIX.exec(file.baseName);
      const groupName = match ? match[1] : file.baseName;
      const order = match ? Number.parseInt(match[2], 10) : 0;
      const group = groups.get(groupName) ?? [];
      group.push({ order, file });
      groups.set(groupName, group);
    }

    const created: BulkUploadResult['created'] = [];
    for (const [groupName, members] of groups) {
      members.sort(
        (a, b) =>
          a.order - b.order || a.file.entryPath.localeCompare(b.file.entryPath),
      );
      const data: Prisma.InputJsonValue = {
        keepSubtitleAfterEnd: false,
        lines: members.map((m) => ({
          id: randomUUID(),
          fileKey: m.file.fileKey,
          durationMs: PLACEHOLDER_DURATION_DEFAULTS.dialogueLine,
          subtitleHtml: '',
        })),
      };
      const asset = await this.prisma.asset.create({
        data: { themeId, kind: 'dialogue', name: groupName, data },
      });
      created.push({
        assetId: asset.id,
        name: asset.name,
        files: members.map((m) => m.file.entryPath),
      });
    }
    return created;
  }

  /**
   * Extracts a static site zip to an immutable S3 prefix. A single wrapping
   * root folder (the common "zip a directory" case) is detected and stripped.
   */
  async importSite(
    themeId: string,
    zipPath: string,
  ): Promise<SiteUploadResponse> {
    // Pass 1: collect entry paths to detect the shared root and require index.html.
    const names: string[] = [];
    const first = await openZip(zipPath);
    this.guardEntryCount(first.entryCount);
    let totalSize = 0;
    await forEachZipEntry(first, (entry) => {
      if (!isDirectoryEntry(entry) && !junkReason(entry.fileName)) {
        totalSize += entry.uncompressedSize;
        this.guardTotalSize(totalSize);
        names.push(entry.fileName);
      }
      return Promise.resolve();
    });
    if (names.length === 0) {
      throw new BadRequestException('Zip contains no usable files');
    }

    const roots = new Set(names.map((n) => n.split('/')[0]));
    const strippedRoot =
      roots.size === 1 && names.every((n) => n.includes('/'))
        ? [...roots][0]
        : null;
    const strip = (name: string): string =>
      strippedRoot ? name.slice(strippedRoot.length + 1) : name;

    if (!names.some((n) => strip(n) === 'index.html')) {
      throw new BadRequestException('Zip must contain index.html at its root');
    }

    // Pass 2: upload. The prefix is immutable — re-uploads get a fresh one and
    // the website asset swaps its sitePrefix pointer.
    const sitePrefix = `sites/${themeId}/${randomUUID()}`;
    let fileCount = 0;
    const second = await openZip(zipPath);
    await forEachZipEntry(second, async (entry) => {
      if (isDirectoryEntry(entry) || junkReason(entry.fileName)) return;
      const stream = await openZipEntryStream(second, entry);
      await this.storage.putStream(
        `${sitePrefix}/${strip(entry.fileName)}`,
        stream,
        mime.lookup(entry.fileName) || 'application/octet-stream',
      );
      fileCount += 1;
    });

    return { sitePrefix, fileCount, strippedRoot };
  }

  private guardEntryCount(count: number): void {
    if (count > MAX_ENTRIES) {
      throw new BadRequestException(
        `Zip has too many entries (max ${MAX_ENTRIES})`,
      );
    }
  }

  private guardTotalSize(total: number): void {
    if (total > MAX_TOTAL_UNCOMPRESSED) {
      throw new BadRequestException('Zip uncompressed size exceeds the limit');
    }
  }
}
