import { Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  DeviceStatus,
  HintShow,
  PlaybackProgress,
  SessionLogEntry,
  SessionMedia,
  SessionNotification,
  SessionRuns,
  SessionState,
  WireCommand,
} from '@roomkit/shared';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import type { RuntimeTransport } from '../runtime/runtime-transport';
import { AdminGateway } from './admin.gateway';
import { ConnectionRegistry } from './connection-registry';
import { DeviceGateway } from './device.gateway';

/** Bridges the runtime's outbound calls onto the socket namespaces. */
@Injectable()
export class RuntimeTransportAdapter implements RuntimeTransport, OnModuleInit {
  constructor(
    private readonly deviceGateway: DeviceGateway,
    private readonly adminGateway: AdminGateway,
    private readonly runtime: SessionRuntimeService,
    private readonly registry: ConnectionRegistry,
  ) {}

  onModuleInit(): void {
    this.runtime.registerTransport(this);
  }

  sendCommand(
    sessionId: string,
    deviceId: string,
    command: WireCommand,
  ): boolean {
    return this.deviceGateway.sendCommand(sessionId, deviceId, command);
  }

  sendProgress(
    sessionId: string,
    deviceId: string,
    progress: PlaybackProgress,
  ): void {
    this.deviceGateway.sendProgress(sessionId, deviceId, progress);
  }

  sendHint(sessionId: string, deviceId: string, hint: HintShow): boolean {
    return this.deviceGateway.sendHint(sessionId, deviceId, hint);
  }

  broadcastSessionState(state: SessionState): void {
    this.deviceGateway.broadcastSessionState(state);
    this.adminGateway.broadcastSessionState(state);
    // A live (created included — devices attach before the explicit start)
    // production session pulls its lobby devices in.
    if (state.mode === 'production' && state.state !== 'ended') {
      this.deviceGateway.sweepLobby(state.sessionId, state.themeId);
    }
    // Socket.io writes packets in order, so clients see the ended state before
    // the disconnect. Their reconnect re-auths into the lobby/next session.
    if (state.state === 'ended') {
      this.deviceGateway.endSession(state.sessionId);
    }
  }

  broadcastLog(entry: SessionLogEntry): void {
    this.adminGateway.broadcastLog(entry);
  }

  broadcastDeviceStatus(status: DeviceStatus): void {
    this.adminGateway.broadcastDeviceStatus(status);
  }

  broadcastSessionRuns(runs: SessionRuns): void {
    this.adminGateway.broadcastSessionRuns(runs);
  }

  broadcastSessionMedia(media: SessionMedia): void {
    this.adminGateway.broadcastSessionMedia(media);
  }

  broadcastNotification(notification: SessionNotification): void {
    this.adminGateway.broadcastNotification(notification);
  }

  hasAnyDeviceOnline(sessionId: string): boolean {
    return this.registry.hasAnyForSession(sessionId);
  }
}
