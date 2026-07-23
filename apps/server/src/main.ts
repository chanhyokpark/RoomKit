import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

// Last-resort safety net: availability during a live game beats fail-fast.
const processLogger = new Logger('process');
process.on('unhandledRejection', (reason) => {
  processLogger.error(`Unhandled rejection: ${String(reason)}`);
});
process.on('uncaughtException', (err) => {
  processLogger.error(`Uncaught exception: ${err.stack ?? String(err)}`);
});

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true, credentials: true });
  // API responses are live state — never cacheable. Without this, Express's
  // default ETag plus the browser cache serve stale session/asset data.
  app.disable('etag');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
