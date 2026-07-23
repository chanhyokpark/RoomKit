import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  BadRequestException,
  Controller,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  BulkUploadKindSchema,
  type BulkUploadKind,
  type BulkUploadResult,
  type SiteUploadResponse,
} from '@roomkit/shared';
import { diskStorage } from 'multer';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { ZipImportsService } from './zip-imports.service';

const MEDIA_ZIP_MAX_BYTES = 4 * 1024 ** 3;
const SITE_ZIP_MAX_BYTES = 500 * 1024 ** 2;

/** Multer writes the zip to a temp file; yauzl then streams entries from it. */
const zipUpload = (fileSize: number) =>
  FileInterceptor('file', {
    storage: diskStorage({ destination: tmpdir() }),
    limits: { fileSize },
  });

@Controller('themes/:themeId/imports')
export class ZipImportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly zipImports: ZipImportsService,
  ) {}

  /** Declared before `:kind` so "site" is never parsed as a media kind. */
  @Post('site')
  @UseInterceptors(zipUpload(SITE_ZIP_MAX_BYTES))
  async importSite(
    @Param('themeId') themeId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<SiteUploadResponse> {
    await this.requireTheme(themeId);
    const zipPath = requireZip(file);
    try {
      return await this.zipImports.importSite(themeId, zipPath);
    } finally {
      await unlink(zipPath).catch(() => {});
    }
  }

  @Post(':kind')
  @UseInterceptors(zipUpload(MEDIA_ZIP_MAX_BYTES))
  async importMedia(
    @Param('themeId') themeId: string,
    @Param('kind', new ZodValidationPipe(BulkUploadKindSchema))
    kind: BulkUploadKind,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<BulkUploadResult> {
    await this.requireTheme(themeId);
    const zipPath = requireZip(file);
    try {
      return await this.zipImports.importMedia(themeId, kind, zipPath);
    } finally {
      await unlink(zipPath).catch(() => {});
    }
  }

  private async requireTheme(themeId: string): Promise<void> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');
  }
}

function requireZip(file: Express.Multer.File | undefined): string {
  if (!file) throw new BadRequestException('Missing zip file (field "file")');
  return file.path;
}
