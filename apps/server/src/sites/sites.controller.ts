import { pipeline } from 'node:stream/promises';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { WebsiteDataSchema } from '@roomkit/shared';
import type { Request, Response } from 'express';
import * as mime from 'mime-types';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Serves hosted website assets extracted to S3 by the site zip import.
 *
 * Public: the player's webview cannot attach the admin JWT to subresource
 * requests. The unguessable asset uuid in the path is the only capability —
 * acceptable for this deployment model (sites are game content, not secrets).
 */
@Controller('sites')
export class SitesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Non-strict routing matches both `/sites/:id` and `/sites/:id/` here.
   * The no-slash form redirects (relative asset paths inside index.html need
   * the trailing slash); the slash form serves index.html.
   */
  @Public()
  @Get(':assetId')
  async root(
    @Param('assetId') assetId: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!req.path.endsWith('/')) {
      res.redirect(301, `${req.originalUrl.split('?')[0]}/`);
      return;
    }
    await this.serveFile(assetId, 'index.html', res);
  }

  @Public()
  @Get(':assetId/{*sitePath}')
  async serve(
    @Param('assetId') assetId: string,
    @Param('sitePath') sitePath: string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.serveFile(assetId, sanitizeSitePath(sitePath), res);
  }

  private async serveFile(
    assetId: string,
    relPath: string,
    res: Response,
  ): Promise<void> {
    const sitePrefix = await this.getSitePrefix(assetId);
    const object = await this.storage.getStream(`${sitePrefix}/${relPath}`);
    res.setHeader(
      'Content-Type',
      object.contentType && object.contentType !== 'application/octet-stream'
        ? object.contentType
        : mime.lookup(relPath) || 'application/octet-stream',
    );
    // The public URL is stable while the prefix behind it changes on
    // re-upload, so allow conditional revalidation but never staleness.
    // (Overrides the global no-store middleware.)
    res.setHeader('Cache-Control', 'no-cache');
    if (object.etag) res.setHeader('ETag', object.etag);
    if (object.contentLength !== undefined) {
      res.setHeader('Content-Length', object.contentLength);
    }
    await pipeline(object.body, res);
  }

  private async getSitePrefix(assetId: string): Promise<string> {
    const asset = await this.prisma.asset.findFirst({
      where: { id: assetId, kind: 'website' },
      select: { data: true },
    });
    if (!asset) throw new NotFoundException('Website not found');
    const parsed = WebsiteDataSchema.safeParse(asset.data);
    if (!parsed.success || parsed.data.mode !== 'hosted') {
      throw new NotFoundException('Website is not hosted');
    }
    return parsed.data.sitePrefix;
  }
}

function sanitizeSitePath(sitePath: string[] | undefined): string {
  const raw = (sitePath ?? []).join('/');
  const decoded = decodeURIComponent(raw);
  const segments = decoded.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..' || s.includes('\\'))) {
    throw new NotFoundException();
  }
  const joined = segments.join('/');
  return joined === '' || decoded.endsWith('/')
    ? `${joined}/index.html`.replace(/^\//, '')
    : joined;
}
