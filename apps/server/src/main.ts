import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { mountPeerServer } from './peer/peer-server';

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
  // ETag is read by studio's asset-list cache (not a CORS-safelisted header).
  app.enableCors({ origin: true, credentials: true, exposedHeaders: ['ETag'] });
  // Large themes produce asset lists of several hundred KB of JSON; gzip
  // cuts them ~5x, which dominates load time on a slow uplink.
  app.use(compression());
  // API responses are live state — never cacheable. Without this, Express's
  // default ETag plus the browser cache serve stale session/asset data.
  // (The asset list sets its own ETag for explicit If-None-Match revalidation.)
  app.disable('etag');
  // PeerJS signaling for voice calls, next to the socket.io namespaces.
  mountPeerServer(app);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
