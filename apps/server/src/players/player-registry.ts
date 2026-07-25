import { Injectable } from '@nestjs/common';
import {
  PlayerEvents,
  type PlayerStatus,
  type PlayerTestStart,
  type PlayerWebsiteTestStart,
  type PlayerWebsiteTestStop,
} from '@roomkit/shared';
import type { Socket } from 'socket.io';

interface PlayerEntry {
  playerName: string;
  sockets: Set<Socket>;
}

/**
 * Tracks connected player launchers (the player app's main window, not its
 * device windows). A player may briefly have multiple sockets during a
 * reconnect overlap; online = at least one. Lives outside GatewayModule so
 * SessionsService can push test:start without a module cycle.
 */
@Injectable()
export class PlayerRegistry {
  private readonly players = new Map<string, PlayerEntry>();

  /** Returns true when this is the player's first live socket (went online). */
  add(playerId: string, playerName: string, socket: Socket): boolean {
    let entry = this.players.get(playerId);
    if (!entry) {
      this.players.set(playerId, (entry = { playerName, sockets: new Set() }));
    }
    // A rename reconnects with the same playerId — freshest name wins.
    entry.playerName = playerName;
    entry.sockets.add(socket);
    return entry.sockets.size === 1;
  }

  /** Returns true when this was the player's last live socket (went offline). */
  remove(playerId: string, socket: Socket): boolean {
    const entry = this.players.get(playerId);
    if (!entry?.sockets.delete(socket)) return false;
    if (entry.sockets.size === 0) {
      this.players.delete(playerId);
      return true;
    }
    return false;
  }

  isOnline(playerId: string): boolean {
    return (this.players.get(playerId)?.sockets.size ?? 0) > 0;
  }

  /** Online players, for the /admin initial dump. */
  onlinePlayers(): PlayerStatus[] {
    return [...this.players.entries()].map(([playerId, entry]) => ({
      playerId,
      playerName: entry.playerName,
      online: true,
    }));
  }

  /** Push a test:start to every socket of the player; false when offline. */
  sendTestStart(playerId: string, payload: PlayerTestStart): boolean {
    const entry = this.players.get(playerId);
    if (!entry || entry.sockets.size === 0) return false;
    for (const socket of entry.sockets) {
      socket.emit(PlayerEvents.testStart, payload);
    }
    return true;
  }

  /** Push a websiteTest:start; false when offline. */
  sendWebsiteTestStart(
    playerId: string,
    payload: PlayerWebsiteTestStart,
  ): boolean {
    const entry = this.players.get(playerId);
    if (!entry || entry.sockets.size === 0) return false;
    for (const socket of entry.sockets) {
      socket.emit(PlayerEvents.websiteTestStart, payload);
    }
    return true;
  }

  /** Push a websiteTest:stop; false when offline. */
  sendWebsiteTestStop(
    playerId: string,
    payload: PlayerWebsiteTestStop,
  ): boolean {
    const entry = this.players.get(playerId);
    if (!entry || entry.sockets.size === 0) return false;
    for (const socket of entry.sockets) {
      socket.emit(PlayerEvents.websiteTestStop, payload);
    }
    return true;
  }
}
