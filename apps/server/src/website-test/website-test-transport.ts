import type {
  SessionState,
  WebsiteTestActivity,
  WebsiteTestRun,
  WireCommand,
} from '@roomkit/shared';

/**
 * Outbound socket surface for website tests, registered by the gateway module
 * after its namespaces initialize — same one-way dependency pattern as
 * RuntimeTransport (GatewayModule → WebsiteTestModule, no forwardRef).
 */
export interface WebsiteTestTransport {
  /** Emit a command to the run's device. Returns false when it is offline. */
  sendCommand(runId: string, deviceId: string, wire: WireCommand): boolean;
  /**
   * Broadcast the synthetic session state to the run's device room only.
   * Website-test states never reach /admin's session:state (they are not
   * sessions and would confuse the operation screen), hence the distinct
   * name from RuntimeTransport.broadcastSessionState.
   */
  broadcastRunSessionState(state: SessionState): void;
  /** Disconnect every device socket attached to the run. */
  disconnectRun(runId: string): void;
  /** Broadcast the run snapshot to /admin. */
  broadcastRunState(run: WebsiteTestRun): void;
  /** Broadcast an activity log entry to /admin. */
  broadcastActivity(entry: WebsiteTestActivity): void;
}

/** Used until the gateway registers the real transport (and in unit tests). */
export const NOOP_WEBSITE_TEST_TRANSPORT: WebsiteTestTransport = {
  sendCommand: () => false,
  broadcastRunSessionState: () => {},
  disconnectRun: () => {},
  broadcastRunState: () => {},
  broadcastActivity: () => {},
};
