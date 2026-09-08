import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Server as HttpServer } from 'node:http';
import { ExpressPeerServer } from 'peer';
import { WebSocketServer, type ServerOptions } from 'ws';

/** Mount path of the PeerJS signaling server (HTTP API + websocket). */
export const PEER_PATH = '/peerjs';

/**
 * Mounts the PeerJS signaling server (operator ↔ hintphone voice calls) on
 * the Nest http server at `/peerjs`: HTTP routes via express, the websocket
 * at `/peerjs/peerjs`.
 *
 * peerjs-server normally builds `new ws.Server({ path, server })`, and `ws`
 * answers every upgrade that does not match its path with HTTP 400 — which
 * would kill socket.io's websocket upgrades on the same server. So the ws
 * server is created in `noServer` mode and only `/peerjs/peerjs` upgrades are
 * handed to it, synchronously: engine.io ends unknown upgrade sockets after a
 * second unless something was already written to them.
 */
export function mountPeerServer(app: NestExpressApplication): void {
  const httpServer: HttpServer = app.getHttpServer();
  let wss: WebSocketServer | null = null;
  const peer = ExpressPeerServer(httpServer, {
    path: '/',
    createWebSocketServer: (options: ServerOptions) => {
      const rest: ServerOptions = { ...options };
      delete rest.server;
      delete rest.path;
      wss = new WebSocketServer({ ...rest, noServer: true });
      return wss;
    },
  });
  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== `${PEER_PATH}/peerjs` || !wss) return;
    const target = wss;
    target.handleUpgrade(req, socket, head, (ws) => {
      target.emit('connection', ws, req);
    });
  });
  app.use(PEER_PATH, peer);
}
