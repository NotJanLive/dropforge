import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userMinerSettings } from "../db/schema.js";
import { requireUser } from "../auth/middleware.js";
import {
  beginTwitchLink,
  getTwitchSession,
  pollTwitchLink,
  unlinkTwitch,
} from "../twitch/session.js";
import { minerManager, parseJsonArray, createUnlinkedMinerStatus } from "../miner/manager.js";
import type { CampaignInfo } from "../miner/constants.js";

const router = Router();

function campaignSummary(c: CampaignInfo) {
  return {
    id: c.id,
    name: c.name,
    gameName: c.gameName,
    gameImageUrl: c.gameImageUrl,
    status: c.status,
    linked: c.linked,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    dropCount: c.drops.length,
  };
}

async function cachedCampaigns(userId: number): Promise<CampaignInfo[]> {
  await minerManager.ensureRunning(userId).catch(() => undefined);
  return minerManager.getStatus(userId)?.campaigns ?? [];
}

router.get("/status", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const session = await getTwitchSession(user.id);
  res.json({
    linked: Boolean(session),
    twitchLogin: session?.login ?? null,
    twitchUserId: session?.userId ?? null,
  });
});

router.post("/link/start", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  try {
    const flow = await beginTwitchLink(user.id);
    res.json({
      userCode: flow.userCode,
      verificationUri: flow.verificationUri,
      expiresAt: flow.expiresAt,
      interval: flow.interval,
      deviceId: flow.deviceId,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start link" });
  }
});

router.post("/link/poll", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  try {
    const result = await pollTwitchLink(user.id, deviceId);
    if (result.status === "completed") {
      void minerManager.ensureRunning(user.id).catch(() => undefined);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Poll failed" });
  }
});

router.post("/unlink", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  await minerManager.stop(user.id);
  unlinkTwitch(user.id);
  res.json({ ok: true });
});

router.get("/campaigns", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const session = await getTwitchSession(user.id);
  if (!session) {
    res.status(400).json({ error: "Twitch not linked" });
    return;
  }
  try {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    if (refresh) {
      await minerManager.refreshCampaignSummaries(user.id);
    }
    const campaigns = await cachedCampaigns(user.id);
    res.json({ campaigns: campaigns.map(campaignSummary), cached: !refresh });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch campaigns" });
  }
});

router.get("/inventory", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const session = await getTwitchSession(user.id);
  if (!session) {
    res.status(400).json({ error: "Twitch not linked" });
    return;
  }
  try {
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    if (refresh) {
      await minerManager.reload(user.id);
    }
    const campaigns = await cachedCampaigns(user.id);
    res.json({ campaigns, cached: !refresh });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch inventory" });
  }
});

router.get("/miner/settings", requireUser, (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const row = db.select().from(userMinerSettings).where(eq(userMinerSettings.userId, user.id)).get();
  res.json({
    priorityMode: row?.priorityMode ?? "PRIORITY_ONLY",
    priorityGames: row ? parseJsonArray(row.priorityGames) : [],
    excludeGames: row ? parseJsonArray(row.excludeGames) : [],
    manualChannelLogin: row?.manualChannelLogin ?? null,
    activeCampaignId: row?.activeCampaignId ?? null,
  });
});

router.put("/miner/settings", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number; setupComplete: boolean } }).currentUser;
  const { priorityMode, priorityGames, excludeGames } = req.body as {
    priorityMode?: string;
    priorityGames?: string[];
    excludeGames?: string[];
  };
  const patch: Partial<import("../miner/worker.js").MinerSettings> = {};
  if (priorityMode !== undefined) {
    patch.priorityMode = priorityMode as import("../miner/constants.js").PriorityMode;
  }
  if (Array.isArray(priorityGames)) patch.priorityGames = priorityGames.map(String);
  if (Array.isArray(excludeGames)) patch.excludeGames = excludeGames.map(String);
  await minerManager.updateSettings(user.id, patch);
  res.json({ ok: true, status: minerManager.getStatus(user.id) });
});

router.get("/miner/status", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const session = await getTwitchSession(user.id);
  if (!session) {
    res.json({ status: createUnlinkedMinerStatus(), twitchLinked: false });
    return;
  }

  const existing = minerManager.getStatus(user.id);
  if (existing) {
    res.json({ status: existing, twitchLinked: true });
    return;
  }
  await minerManager.ensureRunning(user.id).catch(() => undefined);
  res.json({
    status: minerManager.getStatus(user.id) ?? createUnlinkedMinerStatus(),
    twitchLinked: true,
  });
});

router.post("/miner/reload", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  await minerManager.reload(user.id);
  res.json({ ok: true, status: minerManager.getStatus(user.id) });
});

router.post("/miner/select-campaign", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const { campaignId } = req.body as { campaignId?: string | null };
  const id = campaignId === undefined || campaignId === "" ? null : String(campaignId);
  await minerManager.selectCampaign(user.id, id);
  res.json({ ok: true, status: minerManager.getStatus(user.id) });
});

router.post("/miner/switch", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const { channelLogin } = req.body as { channelLogin?: string };
  if (!channelLogin) {
    res.status(400).json({ error: "channelLogin required" });
    return;
  }
  await minerManager.switchChannel(user.id, channelLogin);
  res.json({ ok: true, status: minerManager.getStatus(user.id) });
});

export default router;
