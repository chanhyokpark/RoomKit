import { Injectable, type OnModuleInit } from '@nestjs/common';
import type {
  DeviceStatus,
  PlaybackProgress,
  SessionLogEntry,
  SessionState,
  WireCommand,
} from '@roomkit/shared';
import { SessionRuntimeService } from '../runtime/session-runtime.service';
import type { RuntimeTransport } from '../runtime/runtime-transport';
import { AdminGateway } from './admin.gateway';
import { DeviceGateway } from './device.gateway';

/** Bridges the runtime's outbound calls onto the two namespaces. */
@Injectable()
export class RuntimeTransportAdapter implements RuntimeTransport, OnModuleInit {
  constructor(
    private readonly deviceGateway: DeviceGateway,
    private readonly adminGateway: AdminGateway,
    private readonly runtime: SessionRuntimeService,
  ) {}

  onModuleInit(): void {
    this.runtime.registerTransport(this);
  }

  sendCommand(sessionId: string, deviceId: string, command: WireCommand): boolean {
    return this.deviceGateway.sendCommand(sessionId, deviceId, command);
  }

  sendProgress(sessionId: string, deviceId: string, progress: PlaybackProgress): void {
    this.deviceGateway.sendProgress(sessionId, deviceId, progress);
  }

  broadcastSessionState(state: SessionState): void {
    this.deviceGateway.broadcastSessionState(state);
    this.adminGateway.broadcastSessionState(state);
    // A freshly running production session pulls its lobby devices in.
    if (state.mode === 'production' && state.state === 'running') {
      this.deviceGateway.sweepLobby(state.sessionId, state.themeId);
    }
  }

  broadcastLog(entry: SessionLogEntry): void {
    this.adminGateway.broadcastLog(entry);
  }

  broadcastDeviceStatus(status: DeviceStatus): void {
    this.adminGateway.broadcastDeviceStatus(status);
  }
}
