import { Logger } from '@nestjs/common';
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
  AckSchema,
  DEVICE_NAMESPACE,
  DeviceAuthSchema,
  DeviceDataSchema,
  DeviceEvents,
  PlaybackProgressSchema,
  TriggerSchema,
  type PlaybackProgress,
  type SessionState,
  type WireCommand,
} from '@roomkit/shared';
import type { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import { ConnectionRegistry, type AttachedDevice } from './connection-registry';

const sessionRoom = (sessionId: string) => `session:${sessionId}`;
const deviceRoom = (sessionId: string, deviceId: string) =>
  `sess:${sessionId}:dev:${deviceId}`;

/**
 * Device namespace. Sockets authenticate in a namespace middleware (Nest
 * guards do NOT run for the connection event) with `auth: { deviceCode }`:
 *
 * - `tst_…` codes → SessionDeviceCode rows of non-ended test sessions.
 * - other codes → device assets; matched to their theme's active production
 *   session, or parked in the lobby until one starts.
 *
 * Fatal connect_error messages: `invalid_code`, `session_ended`.
 */
@WebSocketGateway({
  namespace: DEVICE_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class DeviceGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(DeviceGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: SessionRuntimeService,
    private readonly registry: ConnectionRegistry,
  ) {}

  afterInit(): void {
    this.server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    const parsed = DeviceAuthSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) throw new Error('invalid_code');
    const code = parsed.data.deviceCode;

    if (code.startsWith('tst_')) {
      const testCode = await this.prisma.sessionDeviceCode.findUnique({
        where: { code },
        include: { session: { select: { state: true } } },
      });
      if (!testCode) throw new Error('invalid_code');
      if (testCode.session.state === 'ended') throw new Error('session_ended');
      const device = await this.prisma.asset.findUnique({
        where: { id: testCode.deviceId },
      });
      if (!device) throw new Error('invalid_code');
      socket.data.attach = this.toAttached(testCode.sessionId, device);
      return;
    }

    const devices = await this.prisma.asset.findMany({
      where: { kind: 'device', code },
    });
    if (devices.length === 0) throw new Error('invalid_code');
    const activeSessions = await this.prisma.session.findMany({
      where: {
        mode: 'production',
        state: { not: 'ended' },
        themeId: { in: devices.map((d) => d.themeId) },
      },
      select: { id: true, themeId: true },
    });
    const matches = devices.flatMap((device) => {
      const session = activeSessions.find((s) => s.themeId === device.themeId);
      return session ? [{ device, session }] : [];
    });
    if (matches.length > 1) {
      this.logger.warn(
        `Device code "${code}" is ambiguous across themes with active sessions; rejecting`,
      );
      throw new Error('invalid_code');
    }
    if (matches.length === 1) {
      socket.data.attach = this.toAttached(matches[0].session.id, matches[0].device);
      return;
    }
    // Valid production code, no active session: park in the lobby.
    const device = devices[0];
    const data = DeviceDataSchema.safeParse(device.data);
    socket.data.lobby = {
      code,
      themeId: device.themeId,
      deviceId: device.id,
      deviceName: device.name,
      displayName: data.success ? data.data.displayName : '',
    };
  }

  handleConnection(socket: Socket): void {
    const attach = socket.data.attach as AttachedDevice | undefined;
    if (attach) {
      this.attachSocket(socket, attach);
      return;
    }
    this.registry.addToLobby({ socket, ...socket.data.lobby });
  }

  handleDisconnect(socket: Socket): void {
    const attach = socket.data.attach as AttachedDevice | undefined;
    if (attach) {
      const wentOffline = this.registry.remove(attach.sessionId, attach.deviceId, socket);
      if (wentOffline) {
        this.runtime.deviceStatusChanged(
          attach.sessionId,
          attach.deviceId,
          attach.deviceName,
          false,
        );
      }
    } else {
      this.registry.removeFromLobby(socket.id);
    }
  }

  private attachSocket(socket: Socket, attach: AttachedDevice): void {
    socket.data.attach = attach;
    void socket.join([
      sessionRoom(attach.sessionId),
      deviceRoom(attach.sessionId, attach.deviceId),
    ]);
    const wentOnline = this.registry.add(attach.sessionId, attach.deviceId, socket);
    const session = this.runtime.getSessionState(attach.sessionId);
    if (session) {
      socket.emit(DeviceEvents.welcome, {
        device: {
          id: attach.deviceId,
          name: attach.deviceName,
          displayName: attach.displayName,
        },
        session,
      });
    }
    if (wentOnline) {
      this.runtime.deviceStatusChanged(
        attach.sessionId,
        attach.deviceId,
        attach.deviceName,
        true,
      );
    }
    // Redeliver unacked commands (same ids — the client dedupes).
    this.runtime.onDeviceConnected(attach.sessionId, attach.deviceId);
  }

  /** Production session started: pull matching lobby sockets in. */
  sweepLobby(sessionId: string, themeId: string): void {
    for (const entry of this.registry.takeLobbyForTheme(themeId)) {
      this.attachSocket(entry.socket, {
        sessionId,
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        displayName: entry.displayName,
      });
    }
  }

  // ── outbound (called via the transport adapter) ──────────────────────────

  sendCommand(sessionId: string, deviceId: string, wire: WireCommand): boolean {
    if (!this.registry.isOnline(sessionId, deviceId)) return false;
    this.server.to(deviceRoom(sessionId, deviceId)).emit(DeviceEvents.command, wire);
    return true;
  }

  sendProgress(sessionId: string, deviceId: string, progress: PlaybackProgress): void {
    this.server.to(deviceRoom(sessionId, deviceId)).emit(DeviceEvents.progress, progress);
  }

  broadcastSessionState(state: SessionState): void {
    this.server.to(sessionRoom(state.sessionId)).emit(DeviceEvents.sessionState, state);
  }

  // ── inbound ──────────────────────────────────────────────────────────────

  @SubscribeMessage(DeviceEvents.ack)
  onAck(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): void {
    const attach = socket.data.attach as AttachedDevice | undefined;
    if (!attach) return;
    const parsed = AckSchema.safeParse(body);
    if (!parsed.success) return;
    this.runtime.handleAck(attach.sessionId, attach.deviceId, parsed.data);
  }

  @SubscribeMessage(DeviceEvents.trigger)
  onTrigger(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): void {
    const attach = socket.data.attach as AttachedDevice | undefined;
    if (!attach) return;
    const parsed = TriggerSchema.safeParse(body);
    if (!parsed.success) return;
    this.runtime.handleDeviceTrigger(attach.sessionId, attach.deviceId, parsed.data);
  }

  @SubscribeMessage(DeviceEvents.progress)
  onProgress(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): void {
    const attach = socket.data.attach as AttachedDevice | undefined;
    if (!attach) return;
    const parsed = PlaybackProgressSchema.safeParse(body);
    if (!parsed.success) return;
    this.runtime.handleProgress(attach.sessionId, attach.deviceId, parsed.data);
  }

  @SubscribeMessage(DeviceEvents.hintSubmit)
  onHintSubmit(@ConnectedSocket() socket: Socket): void {
    const attach = socket.data.attach as AttachedDevice | undefined;
    this.logger.log(
      `hint:submit from device ${attach?.deviceId ?? socket.id} ignored (hint flow lands in M4)`,
    );
  }

  private toAttached(
    sessionId: string,
    device: { id: string; name: string; data: unknown },
  ): AttachedDevice {
    const data = DeviceDataSchema.safeParse(device.data);
    return {
      sessionId,
      deviceId: device.id,
      deviceName: device.name,
      displayName: data.success ? data.data.displayName : '',
    };
  }
}
