import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { userMinerSettings } from "../db/schema.js";
import { requireUser } from "../auth/middleware.js";
import {
  beginTwitchLink,
  completeTwitchLink,
  getTwitchSession,
  pollTwitchLink,
  unlinkTwitch,
} from "../twitch/session.js";
import { minerManager, parseJsonArray, createUnlinkedMinerStatus, loadMinerLogs } from "../miner/manager.js";
import type { RewardQueueEntry, CampaignInfo } from "../miner/constants.js";
import { listCategoryChannels, rewardDirectory } from "../miner/rewards.js";

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
    res.json(beginTwitchLink(user.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to start link" });
  }
});

router.post("/link/poll", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  try {
    const result = await pollTwitchLink(user.id);
    if (result.status === "completed") {
      void minerManager.ensureRunning(user.id).catch(() => undefined);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Poll failed" });
  }
});

router.post("/link/complete", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const { redirectUrl } = req.body as { redirectUrl?: string };
  if (!redirectUrl) {
    res.status(400).json({ error: "redirectUrl required" });
    return;
  }
  try {
    await completeTwitchLink(user.id, redirectUrl);
    void minerManager.ensureRunning(user.id).catch(() => undefined);
    res.json({ status: "completed" });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Twitch link failed" });
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
    res.json({ status: createUnlinkedMinerStatus(loadMinerLogs(user.id)), twitchLinked: false });
    return;
  }

  const existing = minerManager.getStatus(user.id);
  if (existing) {
    res.json({ status: existing, twitchLinked: true });
    return;
  }
  await minerManager.ensureRunning(user.id).catch(() => undefined);
  res.json({
    status: minerManager.getStatus(user.id) ?? createUnlinkedMinerStatus(loadMinerLogs(user.id)),
    twitchLinked: true,
  });
});

router.post("/miner/reload", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  try {
    await minerManager.reload(user.id);
    res.json({ ok: true, status: minerManager.getStatus(user.id) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Reload failed" });
  }
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

router.get("/rewards", requireUser, (_req, res) => {
  res.json({ campaigns: rewardDirectory.list(), scan: rewardDirectory.info() });
});

router.post("/rewards/lookup", requireUser, async (req, res) => {
  const { login } = req.body as { login?: string };
  const name = String(login ?? "").trim().replace(/^@/, "");
  if (!/^[a-zA-Z0-9_]{2,25}$/.test(name)) {
    res.status(400).json({ error: "Enter a valid Twitch channel name" });
    return;
  }
  try {
    res.json({ campaigns: await rewardDirectory.lookup(name) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Lookup failed" });
  }
});

router.put("/miner/rewards", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const { queue, pinnedId } = req.body as { queue?: unknown; pinnedId?: unknown };
  if (!Array.isArray(queue)) {
    res.status(400).json({ error: "queue must be an array of reward ids" });
    return;
  }
  const current = new Map(
    minerManager.getRewardSettings(user.id).rewardQueue.map((e) => [e.id, e] as const)
  );
  const entries: RewardQueueEntry[] = [];
  let skipped = 0;
  for (const raw of queue) {
    const id = String(raw);
    const known = current.get(id);
    const fresh = known ? rewardDirectory.entry(id) : await rewardDirectory.resolveEntry(id);
    // Keep the user's channel pick when the snapshot is refreshed.
    const entry = fresh ? { ...fresh, preferredChannel: known?.preferredChannel ?? null } : known;
    if (entry) entries.push(entry);
    else skipped++;
  }
  const pinned = typeof pinnedId === "string" && pinnedId ? pinnedId : null;
  await minerManager.updateRewardQueue(user.id, entries, pinned);
  res.json({ ok: true, skipped, status: minerManager.getStatus(user.id) });
});

router.get("/rewards/channels", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const id = String(req.query.id ?? "");
  const entry =
    minerManager.getRewardSettings(user.id).rewardQueue.find((e) => e.id === id) ?? rewardDirectory.entry(id);
  if (!entry || entry.kind !== "category") {
    res.status(404).json({ error: "Reward campaign not found" });
    return;
  }
  res.json({ channels: await listCategoryChannels(entry.categoryIds) });
});

router.put("/miner/rewards/channel", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: { id: number } }).currentUser;
  const { id, channel } = req.body as { id?: string; channel?: string | null };
  const login = typeof channel === "string" ? channel.trim().replace(/^@/, "").toLowerCase() : "";
  if (!id || (login && !/^[a-z0-9_]{2,25}$/.test(login))) {
    res.status(400).json({ error: "Invalid reward or channel" });
    return;
  }
  await minerManager.setRewardChannel(user.id, id, login || null);
  res.json({ ok: true, status: minerManager.getStatus(user.id) });
});

export default router;
