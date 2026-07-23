import { Module } from '@nestjs/common';
import { ZipImportsController } from './zip-imports.controller';
import { ZipImportsService } from './zip-imports.service';

@Module({
  controllers: [ZipImportsController],
  providers: [ZipImportsService],
})
export class ZipImportsModule {}
