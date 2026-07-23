import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CreateThemeInputSchema,
  DuplicateThemeInputSchema,
  UpdateThemeInputSchema,
  type CreateThemeInput,
  type DuplicateThemeInput,
  type UpdateThemeInput,
} from '@roomkit/shared';
import { diskStorage } from 'multer';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ThemeDuplicator } from './theme-duplicator';
import { ThemeExporter } from './theme-exporter';
import { ThemeImporter } from './theme-importer';
import { ThemesService } from './themes.service';

const THEME_ZIP_MAX_BYTES = 8 * 1024 ** 3;

@Controller('themes')
export class ThemesController {
  constructor(
    private readonly themesService: ThemesService,
    private readonly themeDuplicator: ThemeDuplicator,
    private readonly themeExporter: ThemeExporter,
    private readonly themeImporter: ThemeImporter,
  ) {}

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

  /** Recreates a theme from an export archive. Declared before `:id` routes. */
  @Post('import')
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer writes the zip to a temp file; yauzl then streams entries from it.
      storage: diskStorage({ destination: tmpdir() }),
      limits: { fileSize: THEME_ZIP_MAX_BYTES },
    }),
  )
  async import(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Missing zip file (field "file")');
    }
    try {
      return await this.themeImporter.import(file.path);
    } finally {
      await unlink(file.path).catch(() => {});
    }
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.themesService.get(id);
  }

  /** Theme + tags + assets + every referenced file, as a portable zip. */
  @Get(':id/export')
  async export(@Param('id') id: string): Promise<StreamableFile> {
    const { stream, filename } =
      await this.themeExporter.createExportStream(id);
    return new StreamableFile(stream, {
      type: 'application/zip',
      disposition: `attachment; filename="theme.zip"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(DuplicateThemeInputSchema))
    input: DuplicateThemeInput,
  ) {
    return this.themeDuplicator.duplicate(id, input);
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
