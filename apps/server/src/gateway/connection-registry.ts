import { Injectable } from '@nestjs/common';
import type { DefaultEventsMap, Socket } from 'socket.io';

export interface AttachedDevice {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  displayName: string;
}

/** Auth middleware sets exactly one of these before the connection event. */
export interface DeviceSocketData {
  attach?: AttachedDevice;
  lobby?: Omit<LobbyEntry, 'socket'>;
  /** Attach belongs to a website-test run, not a session (attach.sessionId = runId). */
  websiteTest?: boolean;
  /** @roomkit/client version from auth; absent = a client predating reporting. */
  clientVersion?: string;
}

/**
 * Component versions detected for one attached device. A key with a null
 * value means the component was seen but predates version reporting; an
 * absent key means nothing was detected (no helper loaded, old server path).
 */
export interface DeviceVersions {
  clientVersion?: string | null;
  helperVersion?: string | null;
}

export type DeviceSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  DeviceSocketData
>;

/** A production device whose code is valid but whose theme has no active session yet. */
export interface LobbyEntry {
  socket: DeviceSocket;
  code: string;
  themeId: string;
  deviceId: string;
  deviceName: string;
  displayName: string;
}

/**
 * Tracks live device sockets. A device may have multiple sockets (e.g. the
 * same test code opened twice); online = at least one socket.
 */
@Injectable()
export class ConnectionRegistry {
  private readonly sockets = new Map<string, Set<Socket>>();
  private readonly lobby = new Map<string, LobbyEntry>();
  /** `${sessionId}:${deviceId}` → detected component versions. */
  private readonly versions = new Map<string, DeviceVersions>();

  /** Returns true when this is the device's first live socket (went online). */
  add(sessionId: string, deviceId: string, socket: Socket): boolean {
    const key = `${sessionId}:${deviceId}`;
    let set = this.sockets.get(key);
    if (!set) this.sockets.set(key, (set = new Set()));
    set.add(socket);
    return set.size === 1;
  }

  /** Returns true when this was the device's last live socket (went offline). */
  remove(sessionId: string, deviceId: string, socket: Socket): boolean {
    const key = `${sessionId}:${deviceId}`;
    const set = this.sockets.get(key);
    if (!set?.delete(socket)) return false;
    if (set.size === 0) {
      this.sockets.delete(key);
      this.versions.delete(key);
      return true;
    }
    return false;
  }

  /** Merge detected component versions for a device (freshest report wins). */
  setVersions(
    sessionId: string,
    deviceId: string,
    patch: DeviceVersions,
  ): void {
    const key = `${sessionId}:${deviceId}`;
    this.versions.set(key, { ...this.versions.get(key), ...patch });
  }

  versionsFor(sessionId: string, deviceId: string): DeviceVersions {
    return this.versions.get(`${sessionId}:${deviceId}`) ?? {};
  }

  isOnline(sessionId: string, deviceId: string): boolean {
    return (this.sockets.get(`${sessionId}:${deviceId}`)?.size ?? 0) > 0;
  }

  /** Online devices, for the /admin initial dump. */
  onlineDevices(): { sessionId: string; deviceId: string }[] {
    return [...this.sockets.keys()].map((key) => {
      const [sessionId, deviceId] = key.split(':');
      return { sessionId, deviceId };
    });
  }

  addToLobby(entry: LobbyEntry): void {
    this.lobby.set(entry.socket.id, entry);
  }

  removeFromLobby(socketId: string): void {
    this.lobby.delete(socketId);
  }

  /** Pull lobby entries for a theme (they are being attached to a new session). */
  takeLobbyForTheme(themeId: string): LobbyEntry[] {
    const taken: LobbyEntry[] = [];
    for (const [socketId, entry] of this.lobby) {
      if (entry.themeId === themeId) {
        this.lobby.delete(socketId);
        taken.push(entry);
      }
    }
    return taken;
  }
}
