import WebSocket from "ws";
import {
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  PUBSUB_URL,
  topicStr,
  MAX_WEBSOCKETS,
  WS_TOPICS_LIMIT,
} from "./constants.js";

export type TopicHandler = (message: Record<string, unknown>) => void;

interface TopicEntry {
  topic: string;
  handler: TopicHandler;
}

export class PubSubConnection {
  private ws: WebSocket | null = null;
  private topics = new Map<string, TopicEntry>();
  private submitted = new Set<string>();
  private closed = false;
  private reconnectRequested = false;
  private nextPing = Date.now();
  private maxPong = Date.now();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor(
    private index: number,
    private accessToken: string,
    private onStatus?: (index: number, status: string, topicCount: number) => void
  ) {}

  addTopics(entries: TopicEntry[]) {
    for (const entry of entries) {
      if (this.topics.size >= WS_TOPICS_LIMIT) break;
      this.topics.set(entry.topic, entry);
    }
    this.syncTopics();
  }

  removeTopics(topicNames: string[]) {
    for (const t of topicNames) {
      this.topics.delete(t);
      this.submitted.delete(t);
    }
    this.syncTopics();
  }

  get topicCount() {
    return this.topics.size;
  }

  async start() {
    this.closed = false;
    await this.connect();
  }

  stop() {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.onStatus?.(this.index, "disconnected", 0);
  }

  private async connect() {
    while (!this.closed) {
      try {
        this.onStatus?.(this.index, "connecting", this.topics.size);
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(PUBSUB_URL);
          this.ws = ws;
          ws.on("open", () => {
            this.onStatus?.(this.index, "connected", this.topics.size);
            this.nextPing = Date.now();
            this.maxPong = Date.now() + PING_TIMEOUT_MS;
            this.startPingLoop();
            this.syncTopics();
            resolve();
          });
          ws.on("message", (data) => this.handleMessage(data.toString()));
          ws.on("close", () => {
            if (!this.closed) reject(new Error("closed"));
          });
          ws.on("error", reject);
        });

        this.reconnectRequested = false;
        await new Promise<void>((resolve) => {
          const ws = this.ws!;
          const onClose = () => resolve();
          ws.on("close", onClose);
          ws.on("error", onClose);
        });
      } catch {
        if (this.closed) break;
        this.onStatus?.(this.index, "reconnecting", this.topics.size);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  private startPingLoop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const now = Date.now();
      if (now >= this.nextPing) {
        this.nextPing = now + PING_INTERVAL_MS;
        this.maxPong = now + PING_TIMEOUT_MS;
        this.send({ type: "PING" });
      } else if (now >= this.maxPong) {
        this.reconnectRequested = true;
        this.ws?.close();
      }
    }, 1000);
  }

  private send(msg: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      if (msg.type !== "PING") {
        msg.nonce = Math.random().toString(36).slice(2, 32);
      }
      this.ws.send(JSON.stringify(msg));
    }
  }

  private syncTopics() {
    const current = new Set(this.topics.keys());
    const removed = [...this.submitted].filter((t) => !current.has(t));
    const added = [...current].filter((t) => !this.submitted.has(t));

    for (let i = 0; i < removed.length; i += 20) {
      this.send({
        type: "UNLISTEN",
        data: { topics: removed.slice(i, i + 20), auth_token: this.accessToken },
      });
    }
    for (const t of removed) this.submitted.delete(t);

    for (let i = 0; i < added.length; i += 20) {
      this.send({
        type: "LISTEN",
        data: { topics: added.slice(i, i + 20), auth_token: this.accessToken },
      });
    }
    for (const t of added) this.submitted.add(t);
  }

  private handleMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const type = msg.type as string;
    if (type === "MESSAGE") {
      const data = msg.data as Record<string, unknown>;
      const topic = data.topic as string;
      const entry = this.topics.get(topic);
      if (entry) {
        try {
          const inner = JSON.parse(data.message as string) as Record<string, unknown>;
          entry.handler(inner);
        } catch {
          /* ignore */
        }
      }
    } else if (type === "PONG") {
      this.maxPong = this.nextPing;
    } else if (type === "RECONNECT") {
      this.ws?.close();
    }
  }
}

export class PubSubPool {
  private connections: PubSubConnection[] = [];

  constructor(
    private accessToken: string,
    private onStatus?: (index: number, status: string, topicCount: number) => void
  ) {}

  addTopics(entries: TopicEntry[]) {
    const pending = [...entries];
    for (let i = 0; i < MAX_WEBSOCKETS && pending.length > 0; i++) {
      let conn = this.connections[i];
      if (!conn) {
        conn = new PubSubConnection(i, this.accessToken, this.onStatus);
        this.connections[i] = conn;
        conn.start().catch(() => undefined);
      }
      const room = WS_TOPICS_LIMIT - conn.topicCount;
      if (room <= 0) continue;
      conn.addTopics(pending.splice(0, room));
    }
  }

  removeTopics(topicNames: string[]) {
    for (const conn of this.connections) {
      conn.removeTopics(topicNames);
    }
  }

  stop() {
    for (const conn of this.connections) conn.stop();
    this.connections = [];
  }

  get connectionCount() {
    return this.connections.filter((c) => c.topicCount > 0).length;
  }
}

export function userTopics(userId: string, handlers: {
  onDrops: TopicHandler;
  onNotifications: TopicHandler;
}): TopicEntry[] {
  return [
    { topic: topicStr("User", "Drops", userId), handler: handlers.onDrops },
    { topic: topicStr("User", "Notifications", userId), handler: handlers.onNotifications },
  ];
}

export function channelTopics(
  channelId: string,
  handlers: { onStreamState: TopicHandler; onStreamUpdate: TopicHandler }
): TopicEntry[] {
  return [
    { topic: topicStr("Channel", "StreamState", channelId), handler: handlers.onStreamState },
    { topic: topicStr("Channel", "StreamUpdate", channelId), handler: handlers.onStreamUpdate },
  ];
}
