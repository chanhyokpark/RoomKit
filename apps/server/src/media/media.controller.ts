import { pipeline } from 'node:stream/promises';
import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { assetDataSchemas, ImageDataSchema } from '@roomkit/shared';
import type { Response } from 'express';
import * as mime from 'mime-types';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Kinds whose `data` carries a single top-level `fileKey`, servable at a
 * stable public URL. Notably image/file assets exist solely for this route —
 * the studio runtime never plays them; hosted websites reference them.
 */
const SERVABLE_KINDS = ['image', 'file', 'video', 'bgm', 'sfx'] as const;
type ServableKind = (typeof SERVABLE_KINDS)[number];

/**
 * Serves a file-backed asset's object at `/api/media/{assetId}` — a stable
 * URL, unlike the expiring presigns used for studio previews. A fileless
 * image asset serves a generated SVG placeholder in its configured ratio, so
 * websites can lay out against the URL before real artwork exists.
 *
 * Public for the same reason as SitesController: webview subresources can't
 * attach the admin JWT; the unguessable asset uuid is the capability.
 */
@Controller('media')
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get(':assetId')
  async serve(
    @Param('assetId') assetId: string,
    @Res() res: Response,
  ): Promise<void> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, kind: { in: [...SERVABLE_KINDS] } },
      select: { kind: true, data: true },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    await this.serveAsset(asset, res);
  }

  private async serveAsset(
    asset: { kind: string; data: unknown },
    res: Response,
  ): Promise<void> {
    const parsed = assetDataSchemas[asset.kind as ServableKind].safeParse(
      asset.data,
    );
    const fileKey = parsed.success ? parsed.data.fileKey : null;
    if (fileKey) {
      await this.serveObject(fileKey, res);
      return;
    }
    if (asset.kind === 'image') {
      const image = ImageDataSchema.safeParse(asset.data);
      servePlaceholder(
        image.success ? image.data.placeholderRatio : '16:9',
        res,
      );
      return;
    }
    throw new NotFoundException('Asset has no file');
  }

  private async serveObject(fileKey: string, res: Response): Promise<void> {
    const object = await this.storage.getStream(fileKey);
    const filename = fileKey.split('/').at(-1) ?? 'file';
    res.setHeader(
      'Content-Type',
      object.contentType && object.contentType !== 'application/octet-stream'
        ? object.contentType
        : mime.lookup(filename) || 'application/octet-stream',
    );
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    // The URL is stable while the key behind it changes on re-upload, so
    // allow conditional revalidation but never staleness. (Overrides the
    // global no-store middleware.)
    res.setHeader('Cache-Control', 'no-cache');
    if (object.etag) res.setHeader('ETag', object.etag);
    if (object.contentLength !== undefined) {
      res.setHeader('Content-Length', object.contentLength);
    }
    await pipeline(object.body, res);
  }
}

function servePlaceholder(ratio: string, res: Response): void {
  const match = /^([1-9]\d*):([1-9]\d*)$/.exec(ratio);
  const [w, h] = match ? [Number(match[1]), Number(match[2])] : [16, 9];
  const width = 800;
  const height = Math.max(1, Math.round((width * h) / w));
  const fontSize = Math.max(12, Math.round(Math.min(width, height) / 6));
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#e2e8f0"/>` +
    `<text x="50%" y="50%" fill="#64748b" font-family="system-ui, sans-serif" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${w}:${h}</text>` +
    `</svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(svg);
}
