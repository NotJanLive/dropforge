import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { twitchSessions, userMinerSettings, users } from "../db/schema.js";
import { getTwitchSession } from "../twitch/session.js";
import { MinerWorker, type MinerSettings } from "./worker.js";
import type { MinerStatus, MinerLogEntry } from "./constants.js";
import { MAX_MINER_LOGS } from "./constants.js";

type BroadcastFn = (userId: number, status: MinerStatus) => void;

export function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const LOG_LEVELS = new Set<MinerLogEntry["level"]>(["info", "warn", "error", "success"]);

export function loadMinerLogs(userId: number): MinerLogEntry[] {
  const row = db.select().from(userMinerSettings).where(eq(userMinerSettings.userId, userId)).get();
  if (!row?.minerLogs) return [];
  try {
    const parsed = JSON.parse(row.minerLogs);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is MinerLogEntry =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof (entry as MinerLogEntry).time === "string" &&
          typeof (entry as MinerLogEntry).message === "string" &&
          LOG_LEVELS.has((entry as MinerLogEntry).level)
      )
      .slice(0, MAX_MINER_LOGS);
  } catch {
    return [];
  }
}

function persistMinerLogs(userId: number, logs: MinerLogEntry[]) {
  const now = new Date().toISOString();
  const payload = JSON.stringify(logs.slice(0, MAX_MINER_LOGS));
  const existing = db.select().from(userMinerSettings).where(eq(userMinerSettings.userId, userId)).get();

  if (existing) {
    db.update(userMinerSettings)
      .set({ minerLogs: payload, updatedAt: now })
      .where(eq(userMinerSettings.userId, userId))
      .run();
    return;
  }

  db.insert(userMinerSettings).values({
    userId,
    priorityMode: "PRIORITY_ONLY",
    priorityGames: "[]",
    excludeGames: "[]",
    selectedCampaigns: "[]",
    manualChannelLogin: null,
    activeCampaignId: null,
    minerLogs: payload,
    updatedAt: now,
  }).run();
}

function loadSettings(userId: number): MinerSettings {
  const row = db.select().from(userMinerSettings).where(eq(userMinerSettings.userId, userId)).get();
  if (!row) {
    return {
      priorityMode: "PRIORITY_ONLY",
      priorityGames: [],
      excludeGames: [],
      manualChannelLogin: null,
      activeCampaignId: null,
    };
  }
  return {
    priorityMode: row.priorityMode as MinerSettings["priorityMode"],
    priorityGames: parseJsonArray(row.priorityGames),
    excludeGames: parseJsonArray(row.excludeGames),
    manualChannelLogin: row.manualChannelLogin,
    activeCampaignId: row.activeCampaignId ?? null,
  };
}

function mergeSettings(before: MinerSettings, partial: Partial<MinerSettings>): MinerSettings {
  const merged = { ...before };
  if (partial.priorityMode !== undefined) merged.priorityMode = partial.priorityMode;
  if (partial.priorityGames !== undefined) merged.priorityGames = partial.priorityGames;
  if (partial.excludeGames !== undefined) merged.excludeGames = partial.excludeGames;
  if (partial.manualChannelLogin !== undefined) merged.manualChannelLogin = partial.manualChannelLogin;
  if (partial.activeCampaignId !== undefined) merged.activeCampaignId = partial.activeCampaignId;
  return merged;
}

export function createUnlinkedMinerStatus(logs: MinerLogEntry[] = []): MinerStatus {
  return {
    state: "STOPPED",
    message: "Twitch account not linked — link your account in Settings to start mining",
    watchingChannel: null,
    watchingGame: null,
    currentDrop: null,
    activeMining: null,
    campaigns: [],
    channels: [],
    logs,
    websocketConnections: 0,
    lastWatchAt: null,
    updatedAt: new Date().toISOString(),
    activeCampaignId: null,
    focusedCampaignId: null,
    focusedCampaignName: null,
    focusedGameName: null,
    miningCampaignOptions: [],
  };
}

export class MinerManager {
  private workers = new Map<number, MinerWorker>();
  private broadcast: BroadcastFn = () => undefined;

  setBroadcast(fn: BroadcastFn) {
    this.broadcast = fn;
  }

  getStatus(userId: number): MinerStatus | null {
    return this.workers.get(userId)?.getStatus() ?? null;
  }

  getAllStatuses(): Record<number, MinerStatus> {
    const out: Record<number, MinerStatus> = {};
    for (const [id, worker] of this.workers) {
      out[id] = worker.getStatus();
    }
    return out;
  }

  private persistSettingsPartial(userId: number, partial: Partial<MinerSettings>) {
    const now = new Date().toISOString();
    const before = loadSettings(userId);
    const merged = mergeSettings(before, partial);
    const existing = db.select().from(userMinerSettings).where(eq(userMinerSettings.userId, userId)).get();

    if (existing) {
      db.update(userMinerSettings)
        .set({
          priorityMode: merged.priorityMode,
          priorityGames: JSON.stringify(merged.priorityGames),
          excludeGames: JSON.stringify(merged.excludeGames),
          manualChannelLogin: merged.manualChannelLogin,
          activeCampaignId: merged.activeCampaignId,
          updatedAt: now,
        })
        .where(eq(userMinerSettings.userId, userId))
        .run();
    } else {
      db.insert(userMinerSettings).values({
        userId,
        priorityMode: merged.priorityMode,
        priorityGames: JSON.stringify(merged.priorityGames),
        excludeGames: JSON.stringify(merged.excludeGames),
        selectedCampaigns: "[]",
        manualChannelLogin: merged.manualChannelLogin,
        activeCampaignId: merged.activeCampaignId,
        updatedAt: now,
      }).run();
    }
  }

  async ensureRunning(userId: number) {
    if (this.workers.has(userId)) return;
    const auth = await getTwitchSession(userId);
    if (!auth) return;
    const settings = loadSettings(userId);
    const logs = loadMinerLogs(userId);
    const worker = new MinerWorker(
      userId,
      auth,
      settings,
      (uid, status) => {
        this.broadcast(uid, status);
      },
      (partial) => {
        this.persistSettingsPartial(userId, partial);
      },
      logs,
      (nextLogs) => {
        persistMinerLogs(userId, nextLogs);
      }
    );
    this.workers.set(userId, worker);
    await worker.start();
  }

  async stop(userId: number) {
    const worker = this.workers.get(userId);
    if (worker) {
      await worker.stop();
      this.workers.delete(userId);
    }
  }

  async updateSettings(userId: number, settings: Partial<MinerSettings>) {
    const now = new Date().toISOString();
    const before = loadSettings(userId);
    const existing = db.select().from(userMinerSettings).where(eq(userMinerSettings.userId, userId)).get();
    const merged = mergeSettings(before, settings);
    const rulesChanged =
      settings.priorityGames !== undefined ||
      settings.excludeGames !== undefined ||
      settings.priorityMode !== undefined;
    const focusChanged = settings.activeCampaignId !== undefined;

    if (existing) {
      db.update(userMinerSettings)
        .set({
          priorityMode: merged.priorityMode,
          priorityGames: JSON.stringify(merged.priorityGames),
          excludeGames: JSON.stringify(merged.excludeGames),
          selectedCampaigns: "[]",
          manualChannelLogin: merged.manualChannelLogin,
          activeCampaignId: merged.activeCampaignId,
          updatedAt: now,
        })
        .where(eq(userMinerSettings.userId, userId))
        .run();
    } else {
      db.insert(userMinerSettings).values({
        userId,
        priorityMode: merged.priorityMode,
        priorityGames: JSON.stringify(merged.priorityGames),
        excludeGames: JSON.stringify(merged.excludeGames),
        selectedCampaigns: "[]",
        manualChannelLogin: merged.manualChannelLogin,
        activeCampaignId: merged.activeCampaignId,
        updatedAt: now,
      }).run();
    }

    await this.ensureRunning(userId);
    const worker = this.workers.get(userId);
    if (worker) {
      worker.updateSettings({
        priorityMode: merged.priorityMode,
        priorityGames: merged.priorityGames,
        excludeGames: merged.excludeGames,
        manualChannelLogin: merged.manualChannelLogin,
        activeCampaignId: merged.activeCampaignId,
      });
      if (rulesChanged) {
        await worker.applyMiningRules();
      } else if (focusChanged) {
        await worker.applyCampaignFocus();
      }
    }
  }

  async selectCampaign(userId: number, campaignId: string | null) {
    await this.updateSettings(userId, {
      activeCampaignId: campaignId,
      manualChannelLogin: null,
    });
  }

  async reload(userId: number) {
    await this.ensureRunning(userId);
    const worker = this.workers.get(userId);
    if (worker) {
      await worker.reloadInventory();
    }
  }

  /** Fast campaign list refresh for Drop lists UI (no drop details / channel rebuild). */
  async refreshCampaignSummaries(userId: number) {
    await this.ensureRunning(userId);
    const worker = this.workers.get(userId);
    if (worker) {
      await worker.refreshCampaignSummaries();
    }
  }

  async switchChannel(userId: number, login: string) {
    await this.updateSettings(userId, { manualChannelLogin: login });
    await this.ensureRunning(userId);
    const worker = this.workers.get(userId);
    if (worker) {
      await worker.switchToChannel(login);
    }
  }

  /** Users with completed setup and a linked Twitch account. */
  listEligibleUserIds(): number[] {
    return db
      .select({ id: users.id })
      .from(users)
      .innerJoin(twitchSessions, eq(twitchSessions.userId, users.id))
      .where(and(eq(users.role, "user"), eq(users.setupComplete, true)))
      .all()
      .map((row) => row.id);
  }

  /** Start one background miner per eligible user (parallel). */
  async startAllEligibleUsers() {
    const ids = this.listEligibleUserIds();
    if (ids.length === 0) return;
    console.log(`Starting miners for ${ids.length} user(s) with linked Twitch…`);
    await Promise.all(ids.map((id) => this.ensureRunning(id).catch(() => undefined)));
  }

  private buildFallbackStatus(
    userId: number,
    setupComplete: boolean,
    twitchLinked: boolean
  ): MinerStatus {
    const logs = loadMinerLogs(userId);
    const base = createUnlinkedMinerStatus(logs);
    if (!setupComplete) {
      return { ...base, state: "STOPPED", message: "User setup incomplete" };
    }
    if (!twitchLinked) {
      return { ...base, state: "STOPPED", message: "Twitch not linked" };
    }
    return { ...base, state: "STOPPED", message: "Miner not running" };
  }

  getAdminUserMinersOverview() {
    const userRows = db
      .select({
        id: users.id,
        username: users.username,
        setupComplete: users.setupComplete,
      })
      .from(users)
      .where(eq(users.role, "user"))
      .all();

    return userRows.map((u) => {
      const twitch = db
        .select({ login: twitchSessions.twitchLogin })
        .from(twitchSessions)
        .where(eq(twitchSessions.userId, u.id))
        .get();
      const twitchLinked = Boolean(twitch);
      const status =
        this.getStatus(u.id) ?? this.buildFallbackStatus(u.id, u.setupComplete, twitchLinked);

      return {
        userId: u.id,
        username: u.username,
        setupComplete: u.setupComplete,
        twitchLinked,
        twitchLogin: twitch?.login ?? null,
        minerRunning: this.workers.has(u.id),
        status,
      };
    });
  }
}

export const minerManager = new MinerManager();
