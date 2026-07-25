import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ADMIN_NAMESPACE,
  AdminAuthSchema,
  AdminEvents,
  type DeviceStatus,
  type PlayerStatus,
  type SessionLogEntry,
  type SessionNotification,
  type SessionRuns,
  type SessionState,
  type WebsiteTestActivity,
  type WebsiteTestRun,
} from '@roomkit/shared';
import type { Namespace, Socket } from 'socket.io';
import { PlayerRegistry } from '../players/player-registry';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import { ConnectionRegistry } from './connection-registry';

const ADMINS_ROOM = 'admins';

/**
 * Studio namespace, M2-minimal: JWT-authenticated broadcasts only
 * (session:state, log, device:status). Session control stays REST.
 */
@WebSocketGateway({
  namespace: ADMIN_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class AdminGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly runtime: SessionRuntimeService,
    private readonly registry: ConnectionRegistry,
    private readonly players: PlayerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(): void {
    this.server.use((socket, next) => {
      const parsed = AdminAuthSchema.safeParse(socket.handshake.auth);
      if (!parsed.success) {
        next(new Error('unauthorized'));
        return;
      }
      this.jwtService.verifyAsync(parsed.data.token).then(
        () => next(),
        () => next(new Error('unauthorized')),
      );
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    await socket.join(ADMINS_ROOM);
    // Initial dump so the studio doesn't have to race REST reads.
    const states = this.runtime.listSessionStates();
    for (const state of states) {
      socket.emit(AdminEvents.sessionState, state);
    }
    for (const runs of this.runtime.listSessionRuns()) {
      socket.emit(AdminEvents.sessionRuns, runs);
    }
    for (const player of this.players.onlinePlayers()) {
      socket.emit(AdminEvents.playerStatus, player);
    }
    const online = this.registry.onlineDevices();
    if (online.length > 0) {
      const devices = await this.prisma.asset.findMany({
        where: { id: { in: online.map((o) => o.deviceId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(devices.map((d) => [d.id, d.name]));
      for (const o of online) {
        socket.emit(AdminEvents.deviceStatus, {
          sessionId: o.sessionId,
          deviceId: o.deviceId,
          deviceName: nameById.get(o.deviceId) ?? '',
          online: true,
        } satisfies DeviceStatus);
      }
    }
  }

  broadcastSessionState(state: SessionState): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.sessionState, state);
  }

  broadcastLog(entry: SessionLogEntry): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.log, entry);
  }

  broadcastDeviceStatus(status: DeviceStatus): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.deviceStatus, status);
  }

  broadcastPlayerStatus(status: PlayerStatus): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.playerStatus, status);
  }

  broadcastSessionRuns(runs: SessionRuns): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.sessionRuns, runs);
  }

  broadcastNotification(notification: SessionNotification): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.notification, notification);
  }

  broadcastWebsiteTestState(run: WebsiteTestRun): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.websiteTestState, run);
  }

  broadcastWebsiteTestActivity(entry: WebsiteTestActivity): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.websiteTestActivity, entry);
  }
}
