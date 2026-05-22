import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { deviceAuthSessions, twitchSessions } from "../db/schema.js";
import { encrypt, decrypt, randomSessionId } from "../utils/crypto.js";
import {
  bootstrapDeviceId,
  buildAuthSession,
  pollDeviceToken,
  startDeviceFlow,
  validateToken,
  type TwitchAuthSession,
} from "./auth.js";
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

export async function beginTwitchLink(userId: number) {
  const deviceId = await bootstrapDeviceId();
  const flow = await startDeviceFlow(deviceId);
  const expiresAt = new Date(Date.now() + flow.expiresIn * 1000).toISOString();

  db.delete(deviceAuthSessions)
    .where(eq(deviceAuthSessions.userId, userId))
    .run();

  db.insert(deviceAuthSessions).values({
    userId,
    deviceCode: flow.deviceCode,
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    intervalSec: flow.interval,
    expiresAt,
    status: "pending",
    createdAt: new Date().toISOString(),
  }).run();

  return {
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    expiresAt,
    interval: flow.interval,
    deviceId,
    deviceCode: flow.deviceCode,
  };
}

export async function pollTwitchLink(userId: number, deviceId: string): Promise<{
  status: "pending" | "completed" | "expired" | "failed";
  session?: TwitchAuthSession;
}> {
  const pending = db
    .select()
    .from(deviceAuthSessions)
    .where(eq(deviceAuthSessions.userId, userId))
    .orderBy(desc(deviceAuthSessions.id))
    .get();

  if (!pending) return { status: "failed" };
  if (pending.status === "completed") {
    const session = await getTwitchSession(userId);
    return session ? { status: "completed", session } : { status: "failed" };
  }
  if (new Date(pending.expiresAt).getTime() < Date.now()) {
    db.update(deviceAuthSessions)
      .set({ status: "expired" })
      .where(eq(deviceAuthSessions.id, pending.id))
      .run();
    return { status: "expired" };
  }

  const token = await pollDeviceToken(deviceId, pending.deviceCode);
  if (!token) return { status: "pending" };

  const validated = await validateToken(token);
  const session = buildAuthSession(deviceId, token, validated.userId, validated.login);
  const sessionId = randomSessionId();

  db.delete(twitchSessions).where(eq(twitchSessions.userId, userId)).run();
  db.insert(twitchSessions).values({
    userId,
    deviceId: session.deviceId,
    accessTokenEnc: encrypt(session.accessToken),
    twitchUserId: session.userId,
    twitchLogin: session.login,
    sessionId,
    linkedAt: new Date().toISOString(),
  }).run();

  db.update(deviceAuthSessions)
    .set({ status: "completed" })
    .where(eq(deviceAuthSessions.id, pending.id))
    .run();

  return { status: "completed", session: { ...session, sessionId } };
}

export function isTwitchLinked(userId: number): boolean {
  return !!db.select().from(twitchSessions).where(eq(twitchSessions.userId, userId)).get();
}
