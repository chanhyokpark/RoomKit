import type { Readable } from 'node:stream';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  THEME_EXPORT_FORMAT_VERSION,
  type JsonValue,
  type ThemeExportManifest,
} from '@roomkit/shared';
import * as yazl from 'yazl';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { collectFileRefs } from './asset-data-refs';

/**
 * Packs a theme into a portable zip: manifest.json (theme + tags + assets
 * with their source ids) plus every referenced S3 object under files/<key>.
 * See ThemeExportManifestSchema for the archive contract.
 */
@Injectable()
export class ThemeExporter {
  private readonly logger = new Logger(ThemeExporter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async createExportStream(
    themeId: string,
  ): Promise<{ stream: Readable; filename: string }> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');

    const [tags, assets] = await Promise.all([
      this.prisma.tag.findMany({ where: { themeId } }),
      this.prisma.asset.findMany({
        where: { themeId },
        include: { tags: { select: { id: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const manifest: ThemeExportManifest = {
      formatVersion: THEME_EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      theme: { name: theme.name, timeLimitMs: theme.timeLimitMs },
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      assets: assets.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        description: a.description,
        code: a.code,
        tagIds: a.tags.map((t) => t.id),
        data: a.data as JsonValue,
      })),
    };

    // Referenced objects, deduped: direct keys plus everything under each
    // hosted website's sitePrefix.
    const keys = new Set<string>();
    const sitePrefixes = new Set<string>();
    for (const asset of assets) {
      const refs = collectFileRefs(asset.kind, asset.data);
      for (const key of refs.keys) keys.add(key);
      for (const prefix of refs.sitePrefixes) sitePrefixes.add(prefix);
    }
    for (const prefix of sitePrefixes) {
      for (const key of await this.storage.listKeys(`${prefix}/`)) {
        keys.add(key);
      }
    }

    const zip = new yazl.ZipFile();
    zip.addBuffer(
      Buffer.from(JSON.stringify(manifest, null, 2)),
      'manifest.json',
    );
    // Entries stream in after the response starts; the returned stream ends
    // when the last one is written (or errors, destroying the response).
    void this.appendFiles(zip, [...keys]);
    // yazl's types say NodeJS.ReadableStream; the runtime object is a PassThrough.
    return {
      stream: zip.outputStream as unknown as Readable,
      filename: `${theme.name}.zip`,
    };
  }

  private async appendFiles(zip: yazl.ZipFile, keys: string[]): Promise<void> {
    try {
      for (const key of keys) {
        let body: Readable;
        let contentLength: number | undefined;
        try {
          ({ body, contentLength } = await this.storage.getStream(key));
        } catch (err) {
          if (err instanceof NotFoundException) {
            // Dangling ref — export the rest; import turns it into a placeholder.
            this.logger.warn(`Skipping missing object ${key}`);
            continue;
          }
          throw err;
        }
        zip.addReadStream(
          body,
          `files/${key}`,
          contentLength !== undefined ? { size: contentLength } : undefined,
        );
        // One S3 stream in flight at a time: wait until yazl drains this
        // entry (back-pressured by the response) before opening the next.
        await new Promise<void>((resolve, reject) => {
          body.once('end', resolve);
          body.once('close', resolve);
          body.once('error', reject);
        });
      }
      zip.end();
    } catch (err) {
      this.logger.error(`Theme export failed mid-stream: ${String(err)}`);
      (zip.outputStream as unknown as Readable).destroy(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
}
