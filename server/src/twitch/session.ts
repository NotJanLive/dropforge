import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { twitchSessions } from "../db/schema.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import {
  bootstrapDeviceId,
  buildAuthSession,
  validateToken,
  type TwitchAuthSession,
} from "./auth.js";
import {
  buildAuthorizeUrl,
  cancelBrowserLogin,
  extractAccessToken,
  getBrowserLoginState,
  startBrowserLogin,
} from "./browserLogin.js";
import { getClientType } from "../miner/constants.js";

export async function getTwitchSession(userId: number): Promise<TwitchAuthSession | null> {
  const row = db.select().from(twitchSessions).where(eq(twitchSessions.userId, userId)).get();
  if (!row) return null;
  try {
    const accessToken = decrypt(row.accessTokenEnc);
    const validated = await validateToken(accessToken);
    const client = getClientType();
    if (validated.clientId !== client.clientId) {
      unlinkTwitch(userId);
      return null;
    }
    return {
      deviceId: row.deviceId,
      accessToken,
      userId: row.twitchUserId,
      login: row.twitchLogin ?? validated.login,
      sessionId: row.sessionId,
    };
  } catch {
    unlinkTwitch(userId);
    return null;
  }
}

export function unlinkTwitch(userId: number) {
  db.delete(twitchSessions).where(eq(twitchSessions.userId, userId)).run();
}

export function beginTwitchLink(userId: number) {
  return {
    authorizeUrl: buildAuthorizeUrl(),
    browserOpened: startBrowserLogin(userId),
  };
}

/** Stores a token from the implicit grant login after checking it with Twitch. */
async function linkTwitchToken(userId: number, accessToken: string) {
  const validated = await validateToken(accessToken);
  if (validated.clientId !== getClientType().clientId) {
    throw new Error("Twitch issued this token for a different client");
  }

  const deviceId = await bootstrapDeviceId();
  const session = buildAuthSession(deviceId, accessToken, validated.userId, validated.login);

  db.delete(twitchSessions).where(eq(twitchSessions.userId, userId)).run();
  db.insert(twitchSessions).values({
    userId,
    deviceId: session.deviceId,
    accessTokenEnc: encrypt(session.accessToken),
    twitchUserId: session.userId,
    twitchLogin: session.login,
    sessionId: session.sessionId,
    linkedAt: new Date().toISOString(),
  }).run();
}

export async function pollTwitchLink(userId: number): Promise<{
  status: "idle" | "pending" | "completed" | "failed";
  error?: string;
}> {
  const state = getBrowserLoginState(userId);
  if (state.status === "failed") return { status: "failed", error: state.error };
  if (state.status !== "completed") return { status: state.status };

  cancelBrowserLogin(userId);
  await linkTwitchToken(userId, state.accessToken);
  return { status: "completed" };
}

export async function completeTwitchLink(userId: number, redirectUrl: string) {
  const accessToken = extractAccessToken(redirectUrl);
  if (!accessToken) {
    throw new Error("No access token in that address. Copy it right after the login finishes.");
  }
  await linkTwitchToken(userId, accessToken);
  cancelBrowserLogin(userId);
}

export function isTwitchLinked(userId: number): boolean {
  return !!db.select().from(twitchSessions).where(eq(twitchSessions.userId, userId)).get();
}
