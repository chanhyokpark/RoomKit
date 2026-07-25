import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { ZipImportsModule } from './zip-imports/zip-imports.module';
import { SitesModule } from './sites/sites.module';
import { MediaModule } from './media/media.module';
import { ThemesModule } from './themes/themes.module';
import { TagsModule } from './tags/tags.module';
import { AssetsModule } from './assets/assets.module';
import { LogsModule } from './logs/logs.module';
import { RuntimeModule } from './runtime/runtime.module';
import { SessionsModule } from './sessions/sessions.module';
import { WebsiteTestModule } from './website-test/website-test.module';
import { GatewayModule } from './gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuthModule,
    StorageModule,
    UploadsModule,
    ZipImportsModule,
    SitesModule,
    MediaModule,
    ThemesModule,
    TagsModule,
    AssetsModule,
    LogsModule,
    RuntimeModule,
    SessionsModule,
    WebsiteTestModule,
    GatewayModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
