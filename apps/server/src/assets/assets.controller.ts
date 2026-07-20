import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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

  @Get()
  list(
    @Param('themeId') themeId: string,
    @Query('kind', new ZodValidationPipe(ListQuerySchema))
    kind?: CreateAssetInput['kind'],
    @Query('tagId') tagId?: string,
  ) {
    return this.assetsService.list(themeId, { kind, tagId });
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
