import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  ADMIN_NAMESPACE,
  DEVICE_NAMESPACE,
  PLAYER_NAMESPACE,
} from '@roomkit/shared';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';

export const ADMIN_ID = 'test-admin';
export const ADMIN_PASSWORD = 'test-password';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

/** Boots the app on a real port so socket.io clients can connect. */
export async function createSocketTestApp(): Promise<{
  app: INestApplication;
  url: string;
}> {
  const app = await createTestApp();
  await app.listen(0);
  return { app, url: await app.getUrl() };
}

export function connectDevice(url: string, deviceCode: string): Socket {
  return io(`${url}${DEVICE_NAMESPACE}`, {
    auth: { deviceCode },
    transports: ['websocket'],
    reconnection: false,
  });
}

export function connectPlayer(
  url: string,
  playerId: string,
  playerName: string,
  version?: string,
): Socket {
  return io(`${url}${PLAYER_NAMESPACE}`, {
    auth: version === undefined ? { playerId, playerName } : { playerId, playerName, version },
    transports: ['websocket'],
    reconnection: false,
  });
}

export function connectAdmin(url: string, token: string): Socket {
  return io(`${url}${ADMIN_NAMESPACE}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
}

/** Resolves with the next `event` payload (rejects on connect_error/timeout). */
export function waitForEvent<T = unknown>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    const onEvent = (payload: T) => {
      cleanup();
      resolve(payload);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(
        new Error(`connect_error while waiting for "${event}": ${err.message}`),
      );
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(event, onEvent);
      socket.off('connect_error', onError);
    };
    socket.once(event, onEvent);
    socket.once('connect_error', onError);
  });
}

export function waitForConnectError(
  socket: Socket,
  timeoutMs = 3000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for connect_error')),
      timeoutMs,
    );
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timeout);
      resolve(err.message);
    });
  });
}

let codeSeq = 0;

/** Unique operator-style test device code (codes are globally unique while live). */
export function nextTestCode(): string {
  return `e2e-${Date.now().toString(36)}-${process.pid.toString(36)}-${(++codeSeq).toString(36)}`;
}

export async function login(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ id: ADMIN_ID, password: ADMIN_PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}
