import { getClientType } from "../miner/constants.js";
import { randomHex, randomSessionId } from "../utils/crypto.js";

export interface TwitchAuthSession {
  deviceId: string;
  accessToken: string;
  userId: string;
  login: string;
  sessionId: string;
}

function authHeaders(deviceId?: string, token?: string): Record<string, string> {
  const client = getClientType();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": "en-US",
    "Client-Id": client.clientId,
    Origin: client.origin,
    Referer: client.origin + "/",
    "User-Agent": client.userAgent,
  };
  if (deviceId) headers["X-Device-Id"] = deviceId;
  if (token) headers.Authorization = `OAuth ${token}`;
  return headers;
}

function extractUniqueId(headers: Headers): string | null {
  const headerWithGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const cookieLines =
    typeof headerWithGetSetCookie.getSetCookie === "function"
      ? headerWithGetSetCookie.getSetCookie()
      : [];

  for (const line of cookieLines) {
    const match = line.match(/(?:^|,\s*)unique_id=([a-f0-9]{32})/i);
    if (match) return match[1];
  }

  const combined = headers.get("set-cookie") ?? "";
  const combinedMatch = combined.match(/unique_id=([a-f0-9]{32})/i);
  if (combinedMatch) return combinedMatch[1];

  return null;
}

export async function bootstrapDeviceId(): Promise<string> {
  const client = getClientType();
  try {
    const res = await fetch(client.origin, {
      headers: {
        "User-Agent": client.userAgent,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    const uniqueId = extractUniqueId(res.headers);
    if (uniqueId) return uniqueId;
  } catch {
    /* use generated fallback below */
  }

  // Twitch accepts a client-generated 32-char hex device id if cookies are unavailable
  return randomHex(16);
}

export async function validateToken(accessToken: string): Promise<{
  userId: string;
  login: string;
  clientId: string;
}> {
  const res = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  if (!res.ok) throw new Error("Token validation failed");
  const data = (await res.json()) as {
    user_id: string;
    login: string;
    client_id: string;
  };
  return {
    userId: data.user_id,
    login: data.login,
    clientId: data.client_id,
  };
}

export function buildAuthSession(
  deviceId: string,
  accessToken: string,
  userId: string,
  login: string
): TwitchAuthSession {
  return {
    deviceId,
    accessToken,
    userId,
    login,
    sessionId: randomSessionId(),
  };
}

export function gqlHeaders(auth: TwitchAuthSession): Record<string, string> {
  const client = getClientType();
  return {
    ...authHeaders(auth.deviceId, auth.accessToken),
    "Client-Session-Id": auth.sessionId,
    "Content-Type": "application/json",
  };
}
