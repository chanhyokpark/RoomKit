import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  PresignUploadInputSchema,
  type PresignUploadInput,
  type PresignUploadResponse,
} from '@roomkit/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { PRESIGN_EXPIRES_IN, StorageService } from '../storage/storage.service';

function sanitizeFilename(filename: string): string {
  const base = filename.split('/').pop()?.split('\\').pop() ?? '';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned || 'file';
}

@Controller()
export class UploadsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Post('themes/:themeId/uploads')
  async presignUpload(
    @Param('themeId') themeId: string,
    @Body(new ZodValidationPipe(PresignUploadInputSchema))
    input: PresignUploadInput,
  ): Promise<PresignUploadResponse> {
    const theme = await this.prisma.theme.findUnique({
      where: { id: themeId },
    });
    if (!theme) throw new NotFoundException('Theme not found');

    const key = `themes/${themeId}/${randomUUID()}/${sanitizeFilename(input.filename)}`;
    const url = await this.storage.presignPut(key, input.contentType);
    return { key, url, expiresIn: PRESIGN_EXPIRES_IN };
  }

  @Get('files/url')
  async fileUrl(@Query('key') key?: string): Promise<{ url: string }> {
    if (!key) throw new BadRequestException('Missing key query parameter');
    return { url: await this.storage.presignGet(key) };
  }
}
