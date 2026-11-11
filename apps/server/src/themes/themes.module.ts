import { Module } from '@nestjs/common';
import { RuntimeModule } from '../runtime/runtime.module';
import { ThemeDuplicator } from './theme-duplicator';
import { ThemeExporter } from './theme-exporter';
import { ThemeImporter } from './theme-importer';
import { ThemesController } from './themes.controller';
import { ThemesService } from './themes.service';

@Module({
  imports: [RuntimeModule],
  controllers: [ThemesController],
  providers: [ThemesService, ThemeDuplicator, ThemeExporter, ThemeImporter],
})
export class ThemesModule {}
