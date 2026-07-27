export {
  RoomKitClient,
  type ConnectionStatus,
  type DoneFn,
  type RoomKitClientEvents,
  type RoomKitClientOptions,
} from './client.js';
export { testCodeKey, type CodeStorage } from './storage.js';
export { CLIENT_VERSION } from './version.js';
export type {
  DeviceAssetEntry,
  DeviceAssetManifest,
  HintError,
  HintShow,
  PlaybackProgress,
  SessionState,
  Welcome,
  WireCommand,
  WireMessage,
  WireNavigate,
  WirePlayCommand,
  WirePlayDialogue,
  WireReset,
  WireStop,
} from '@roomkit/shared';
