import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  PLAYER_NAMESPACE,
  PlayerAuthSchema,
  type PlayerAuth,
} from '@roomkit/shared';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { PlayerRegistry } from '../players/player-registry';
import { AdminGateway } from './admin.gateway';

/** Auth middleware sets `player` before the connection event. */
interface PlayerSocketData {
  player?: PlayerAuth;
}
type PlayerSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  PlayerSocketData
>;

/**
 * Player launcher namespace. Unauthenticated like /device (players hold no
 * secret); the handshake only carries the player's self-generated identity.
 * The server pushes `test:start` here when a studio-created test session
 * targets the player (emitted by SessionsService via the registry).
 */
@WebSocketGateway({
  namespace: PLAYER_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class PlayerGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Namespace<
    DefaultEventsMap,
    DefaultEventsMap,
    DefaultEventsMap,
    PlayerSocketData
  >;

  constructor(
    private readonly players: PlayerRegistry,
    private readonly admin: AdminGateway,
  ) {}

  afterInit(): void {
    this.server.use((socket, next) => {
      const parsed = PlayerAuthSchema.safeParse(socket.handshake.auth);
      if (!parsed.success) {
        next(new Error('invalid_player'));
        return;
      }
      socket.data.player = parsed.data;
      next();
    });
  }

  handleConnection(socket: PlayerSocket): void {
    const player = socket.data.player;
    if (!player) return;
    this.players.add(
      player.playerId,
      player.playerName,
      socket,
      player.version ?? null,
    );
    // Broadcast on every connect (not just first-socket): a rename reconnects
    // with the same playerId and admins upsert by id, so this refreshes the name.
    this.admin.broadcastPlayerStatus({
      playerId: player.playerId,
      playerName: player.playerName,
      online: true,
      version: player.version ?? null,
    });
  }

  handleDisconnect(socket: PlayerSocket): void {
    const player = socket.data.player;
    if (!player) return;
    if (this.players.remove(player.playerId, socket)) {
      this.admin.broadcastPlayerStatus({
        playerId: player.playerId,
        playerName: player.playerName,
        online: false,
        version: player.version ?? null,
      });
    }
  }
}
