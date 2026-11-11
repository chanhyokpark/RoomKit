import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AssetKindSchema,
  CreateAssetInputSchema,
  UpdateAssetInputSchema,
  type CreateAssetInput,
  type UpdateAssetInput,
} from '@roomkit/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AssetsService } from './assets.service';

const ListQuerySchema = AssetKindSchema.optional();

@Controller('themes/:themeId/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  /**
   * The list is the heaviest payload of the API (every sequence and dialogue
   * of the theme), so it answers `If-None-Match` with a bodiless 304 when the
   * caller's copy is still current. Caching stays opt-in: the response keeps
   * the global `no-store`, only clients that hold their own copy revalidate.
   */
  @Get()
  async list(
    @Param('themeId') themeId: string,
    @Res({ passthrough: true }) res: Response,
    @Query('kind', new ZodValidationPipe(ListQuerySchema))
    kind?: CreateAssetInput['kind'],
    @Query('tagId') tagId?: string,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const assets = await this.assetsService.list(themeId, { kind, tagId });
    const body = JSON.stringify(assets);
    const etag = `"${createHash('sha1').update(body).digest('base64url')}"`;
    res.setHeader('ETag', etag);
    if (ifNoneMatch === etag) {
      res.status(304);
      return;
    }
    res.type('application/json');
    return body;
  }

  @Post()
  create(
    @Param('themeId') themeId: string,
    @Body(new ZodValidationPipe(CreateAssetInputSchema))
    input: CreateAssetInput,
  ) {
    return this.assetsService.create(themeId, input);
  }

  @Get(':id')
  get(@Param('themeId') themeId: string, @Param('id') id: string) {
    return this.assetsService.get(themeId, id);
  }

  @Patch(':id')
  update(
    @Param('themeId') themeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateAssetInputSchema))
    input: UpdateAssetInput,
  ) {
    return this.assetsService.update(themeId, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('themeId') themeId: string, @Param('id') id: string) {
    await this.assetsService.remove(themeId, id);
  }
}
