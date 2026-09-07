import type { ApiClient } from './http.js';
import type { SessionState } from './session.js';
import type { VirtualDeviceManager } from './virtual-device.js';

/**
 * What the core operations need: an authenticated API client, connection
 * state, and the virtual-device manager. Theme resolution happens in the
 * command layer — ops always receive a resolved theme uuid.
 */
export interface OpsContext {
  api: ApiClient;
  state: SessionState;
  devices: VirtualDeviceManager;
}
