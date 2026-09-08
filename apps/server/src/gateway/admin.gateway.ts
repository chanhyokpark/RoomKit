import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  ADMIN_NAMESPACE,
  AdminAuthSchema,
  AdminEvents,
  CallAcceptInputSchema,
  CallDeclineInputSchema,
  CallEndInputSchema,
  CallStartInputSchema,
  type CallActionAck,
  type CallConfig,
  type DeviceScreenshot,
  type DeviceStatus,
  type PlayerStatus,
  type SessionLogEntry,
  type SessionMedia,
  type SessionNotification,
  type SessionRuns,
  type SessionState,
  type ThemeAssetsChanged,
} from '@roomkit/shared';
import type { Namespace, Socket } from 'socket.io';
import { PlayerRegistry } from '../players/player-registry';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import { ThemeEventsService } from '../theme-events/theme-events.service';
import { CallService } from './call.service';
import { ConnectionRegistry } from './connection-registry';

const ADMINS_ROOM = 'admins';

/**
 * Studio namespace: JWT-authenticated broadcasts (session:state, log,
 * device:status, ...). Session control stays REST; voice calls are the one
 * socket-driven control, because a call is owned by the admin socket that
 * started it (its disconnect ends the call).
 */
@WebSocketGateway({
  namespace: ADMIN_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class AdminGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwtService: JwtService,
    private readonly runtime: SessionRuntimeService,
    private readonly registry: ConnectionRegistry,
    private readonly players: PlayerRegistry,
    private readonly prisma: PrismaService,
    private readonly calls: CallService,
    themeEvents: ThemeEventsService,
  ) {
    themeEvents.onAssetsChanged((themeId) =>
      this.broadcastThemeAssets({ themeId }),
    );
    calls.onAdminChange((state) =>
      this.server.to(ADMINS_ROOM).emit(AdminEvents.callState, state),
    );
  }

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
    for (const media of this.runtime.listSessionMedia()) {
      socket.emit(AdminEvents.sessionMedia, media);
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
        socket.emit(
          AdminEvents.deviceStatus,
          this.withVersions({
            sessionId: o.sessionId,
            deviceId: o.deviceId,
            deviceName: nameById.get(o.deviceId) ?? '',
            online: true,
          }),
        );
      }
    }
    for (const screenshot of this.registry.latestScreenshots()) {
      socket.emit(AdminEvents.deviceScreenshot, screenshot);
    }
    for (const call of this.calls.listCalls()) {
      socket.emit(AdminEvents.callState, { sessionId: call.sessionId, call });
    }
  }

  /** An operator's socket going away ends every call it owns. */
  handleDisconnect(socket: Socket): void {
    this.calls.adminDisconnected(socket.id);
  }

  // ── voice calls (socket.io acks) ─────────────────────────────────────────

  @SubscribeMessage(AdminEvents.callConfig)
  onCallConfig(): CallConfig {
    return { iceServers: this.calls.iceServers() };
  }

  @SubscribeMessage(AdminEvents.callStart)
  async onCallStart(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<CallActionAck> {
    const parsed = CallStartInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'invalid' };
    const device = await this.prisma.asset.findUnique({
      where: { id: parsed.data.deviceId },
      select: { name: true },
    });
    if (!device) return { ok: false, reason: 'invalid' };
    return this.calls.start(socket.id, parsed.data, device.name);
  }

  @SubscribeMessage(AdminEvents.callAccept)
  onCallAccept(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): CallActionAck {
    const parsed = CallAcceptInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'invalid' };
    return this.calls.accept(socket.id, parsed.data);
  }

  @SubscribeMessage(AdminEvents.callDecline)
  onCallDecline(@MessageBody() body: unknown): CallActionAck {
    const parsed = CallDeclineInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'invalid' };
    return this.calls.decline(parsed.data);
  }

  @SubscribeMessage(AdminEvents.callEnd)
  onCallEnd(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): CallActionAck {
    const parsed = CallEndInputSchema.safeParse(body);
    if (!parsed.success) return { ok: false, reason: 'invalid' };
    return this.calls.end(socket.id, parsed.data);
  }

  /**
   * Attach the registry's detected component versions to a device:status so
   * studio can warn about outdated clients/helpers. Centralized here because
   * every status broadcast (engine transport, gateway refreshes, the initial
   * dump) funnels through this gateway.
   */
  private withVersions(status: DeviceStatus): DeviceStatus {
    return {
      ...status,
      ...this.registry.versionsFor(status.sessionId, status.deviceId),
    };
  }

  broadcastSessionState(state: SessionState): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.sessionState, state);
  }

  broadcastLog(entry: SessionLogEntry): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.log, entry);
  }

  broadcastDeviceStatus(status: DeviceStatus): void {
    this.server
      .to(ADMINS_ROOM)
      .emit(AdminEvents.deviceStatus, this.withVersions(status));
  }

  broadcastDeviceScreenshot(screenshot: DeviceScreenshot): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.deviceScreenshot, screenshot);
  }

  broadcastPlayerStatus(status: PlayerStatus): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.playerStatus, status);
  }

  broadcastSessionRuns(runs: SessionRuns): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.sessionRuns, runs);
  }

  broadcastSessionMedia(media: SessionMedia): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.sessionMedia, media);
  }

  broadcastNotification(notification: SessionNotification): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.notification, notification);
  }

  broadcastThemeAssets(payload: ThemeAssetsChanged): void {
    this.server.to(ADMINS_ROOM).emit(AdminEvents.themeAssets, payload);
  }
}
