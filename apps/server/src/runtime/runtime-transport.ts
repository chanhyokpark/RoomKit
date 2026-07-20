import type {
  DeviceStatus,
  PlaybackProgress,
  SessionState,
  SessionLogEntry,
  WireCommand,
} from '@roomkit/shared';

/**
 * The runtime's outbound socket surface, registered by the gateway module
 * after its namespaces initialize. Keeps the dependency direction one-way
 * (GatewayModule → RuntimeModule) without forwardRef.
 */
export interface RuntimeTransport {
  /** Emit a command to one device. Returns false when the device is offline. */
  sendCommand(sessionId: string, deviceId: string, command: WireCommand): boolean;
  /** Relay dialogue line progress to the screen device. */
  sendProgress(sessionId: string, deviceId: string, progress: PlaybackProgress): void;
  /** Broadcast to the session's devices and to /admin. */
  broadcastSessionState(state: SessionState): void;
  /** Broadcast to /admin. */
  broadcastLog(entry: SessionLogEntry): void;
  /** Broadcast to /admin. */
  broadcastDeviceStatus(status: DeviceStatus): void;
}

/** Used until the gateway registers the real transport (and in unit tests). */
export const NOOP_TRANSPORT: RuntimeTransport = {
  sendCommand: () => false,
  sendProgress: () => {},
  broadcastSessionState: () => {},
  broadcastLog: () => {},
  broadcastDeviceStatus: () => {},
};
