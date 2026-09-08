export {
  RoomKitClient,
  type ConnectionStatus,
  type DoneFn,
  type GetRemainingTimeOptions,
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
  WireBgmVolume,
  WireCommand,
  WireHintCode,
  WireMessage,
  WireNavigate,
  WirePlayCommand,
  WirePlayDialogue,
  WireReset,
  WireState,
  WireStop,
  WireTestCallback,
} from '@roomkit/shared';
