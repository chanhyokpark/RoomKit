import { Module } from '@nestjs/common';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { DeviceAssetsService } from './device-assets.service';

@Module({
  controllers: [AssetsController],
  providers: [AssetsService, DeviceAssetsService],
  exports: [DeviceAssetsService],
})
export class AssetsModule {}
