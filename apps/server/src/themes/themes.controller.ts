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
  CreateThemeInputSchema,
  UpdateThemeInputSchema,
  type CreateThemeInput,
  type UpdateThemeInput,
} from '@roomkit/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ThemesService } from './themes.service';

@Controller('themes')
export class ThemesController {
  constructor(private readonly themesService: ThemesService) {}

  @Get()
  list() {
    return this.themesService.list();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(CreateThemeInputSchema))
    input: CreateThemeInput,
  ) {
    return this.themesService.create(input);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.themesService.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateThemeInputSchema))
    input: UpdateThemeInput,
  ) {
    return this.themesService.update(id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.themesService.remove(id);
  }
}
