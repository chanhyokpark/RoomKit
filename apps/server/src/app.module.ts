import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { ThemesModule } from './themes/themes.module';
import { TagsModule } from './tags/tags.module';
import { AssetsModule } from './assets/assets.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    StorageModule,
    UploadsModule,
    ThemesModule,
    TagsModule,
    AssetsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
