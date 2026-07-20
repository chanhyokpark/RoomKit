import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CreateTagInputSchema,
  UpdateTagInputSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from '@roomkit/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TagsService } from './tags.service';

@Controller('themes/:themeId/tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list(@Param('themeId') themeId: string) {
    return this.tagsService.list(themeId);
  }

  @Post()
  create(
    @Param('themeId') themeId: string,
    @Body(new ZodValidationPipe(CreateTagInputSchema)) input: CreateTagInput,
  ) {
    return this.tagsService.create(themeId, input);
  }

  @Patch(':id')
  update(
    @Param('themeId') themeId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTagInputSchema)) input: UpdateTagInput,
  ) {
    return this.tagsService.update(themeId, id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('themeId') themeId: string, @Param('id') id: string) {
    await this.tagsService.remove(themeId, id);
  }
}
