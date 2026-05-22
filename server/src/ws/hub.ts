import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import type { MinerStatus } from "../miner/constants.js";

interface ClientMeta {
  userId: number | null;
  ws: WebSocket;
}

export class UiWebSocketHub {
  private wss: WebSocketServer;
  private clients = new Set<ClientMeta>();
  private getStatus: (userId: number) => MinerStatus | null;

  constructor(server: Server, getStatus: (userId: number) => MinerStatus | null) {
    this.getStatus = getStatus;
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (ws, req) => this.onConnection(ws, req));
  }

  private sendSnapshot(ws: WebSocket, userId: number) {
    const status = this.getStatus(userId);
    if (!status) return;
    ws.send(JSON.stringify({ type: "miner_status", userId, status }));
  }

  private onConnection(ws: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url ?? "/ws", "http://localhost");
    const userIdParam = url.searchParams.get("userId");
    const parsedUserId = userIdParam ? Number(userIdParam) : null;
    const meta: ClientMeta = {
      userId: parsedUserId !== null && Number.isFinite(parsedUserId) ? parsedUserId : null,
      ws,
    };
    this.clients.add(meta);

    if (meta.userId !== null) {
      this.sendSnapshot(ws, meta.userId);
    }

    ws.on("close", () => this.clients.delete(meta));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; userId?: number };
        if (msg.type === "subscribe" && msg.userId) {
          meta.userId = msg.userId;
          this.sendSnapshot(ws, msg.userId);
        }
      } catch {
        /* ignore */
      }
    });

    ws.send(JSON.stringify({ type: "connected", at: new Date().toISOString() }));
  }

  broadcastMinerStatus(userId: number, status: MinerStatus) {
    const payload = JSON.stringify({ type: "miner_status", userId, status });
    for (const client of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN && client.userId === userId) {
        client.ws.send(payload);
      }
    }
  }

  broadcastAll(payload: Record<string, unknown>) {
    const data = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) client.ws.send(data);
    }
  }
}

export let uiHub: UiWebSocketHub;

export function initUiWebSocket(
  server: Server,
  getStatus: (userId: number) => MinerStatus | null
) {
  uiHub = new UiWebSocketHub(server, getStatus);
  return uiHub;
}
