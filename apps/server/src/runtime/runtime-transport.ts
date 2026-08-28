import type {
  DeviceStatus,
  HintShow,
  PlaybackProgress,
  SessionMedia,
  SessionNotification,
  SessionRuns,
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
  sendCommand(
    sessionId: string,
    deviceId: string,
    command: WireCommand,
  ): boolean;
  /** Relay dialogue line progress to the screen device. */
  sendProgress(
    sessionId: string,
    deviceId: string,
    progress: PlaybackProgress,
  ): void;
  /** Emit hint:show to one device. Returns false when the device is offline. */
  sendHint(sessionId: string, deviceId: string, hint: HintShow): boolean;
  /** Broadcast to the session's devices and to /admin. */
  broadcastSessionState(state: SessionState): void;
  /** Broadcast to /admin. */
  broadcastLog(entry: SessionLogEntry): void;
  /** Broadcast to /admin. */
  broadcastDeviceStatus(status: DeviceStatus): void;
  /** Broadcast to /admin. */
  broadcastSessionRuns(runs: SessionRuns): void;
  /** Broadcast to /admin. */
  broadcastSessionMedia(media: SessionMedia): void;
  /** Broadcast to /admin. */
  broadcastNotification(notification: SessionNotification): void;
  /** True while at least one device socket of the session is connected. */
  hasAnyDeviceOnline(sessionId: string): boolean;
}

/** Used until the gateway registers the real transport (and in unit tests). */
export const NOOP_TRANSPORT: RuntimeTransport = {
  sendCommand: () => false,
  sendProgress: () => {},
  sendHint: () => false,
  broadcastSessionState: () => {},
  broadcastLog: () => {},
  broadcastDeviceStatus: () => {},
  broadcastSessionRuns: () => {},
  broadcastSessionMedia: () => {},
  broadcastNotification: () => {},
  hasAnyDeviceOnline: () => false,
};
