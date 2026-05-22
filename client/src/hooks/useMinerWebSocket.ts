import { useEffect, useRef, useState } from "react";
import type { MinerStatus } from "@/lib/api";

export function useMinerWebSocket(userId: number | null) {
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!userId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?userId=${userId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", userId }));
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "miner_status" && msg.userId === userId) {
          setStatus(msg.status);
        }
      } catch {
        /* ignore */
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [userId]);

  return status;
}
