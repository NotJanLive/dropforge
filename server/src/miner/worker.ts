import type { TwitchAuthSession } from "../twitch/auth.js";
import {
  type CampaignInfo,
  type ChannelInfo,
  type DropProgress,
  type MinerLogEntry,
  type MinerState,
  type MinerStatus,
  type PriorityMode,
  WATCH_INTERVAL_MS,
  PROGRESS_CHECK_TICKS,
  ONLINE_DELAY_MS,
  MAX_CHANNELS,
  CHANNEL_REFRESH_MS,
  DROP_CHECK_CHANNELS,
  LOOP_INTERVAL_MS,
  INVENTORY_MAINTENANCE_MS,
  IDLE_INVENTORY_REFRESH_MS,
  MAX_MINER_LOGS,
  type RewardQueueEntry,
  type RewardQueueState,
  type RewardQueueView,
} from "./constants.js";
import {
  rewardDirectory,
  claimReward,
  fetchRewardProgress,
  findCategoryChannel,
  type RewardProgress,
} from "./rewards.js";
import { PubSubPool, userTopics, channelTopics } from "./pubsub.js";
import {
  fetchInventory,
  enrichChannelsOnline,
  discoverGameChannels,
  mergeChannels,
  filterCampaignsForMining,
  campaignHasEarnableDrops,
  sortCampaignsForDisplay,
  mergeCampaignProgress,
  pickBestChannel,
  claimDrop,
  parseDropProgress,
  applyDropProgress,
  findDropInCampaigns,
  fetchCampaignDetail,
  channelMatchesCampaigns,
  dropCanClaim,
  resolveClaimId,
  invalidateCampaignSourceCache,
  finalizeCampaigns,
  resolveFocusedCampaign,
} from "./inventory.js";
import { fetchStreamInfo, sendWatchStream, checkChannelCampaignDrops } from "./channel.js";
import { GqlClient } from "./gql.js";
import { computeActiveMining, updateDropMinutesInCampaigns, extractImagesFromSession } from "./progress.js";

export interface MinerSettings {
  priorityMode: PriorityMode;
  priorityGames: string[];
  excludeGames: string[];
  manualChannelLogin: string | null;
  activeCampaignId: string | null;
  rewardQueue: RewardQueueEntry[];
  pinnedRewardId: string | null;
}

/** Progress checks (~1 min each) without a credited minute before moving on. */
const REWARD_STALL_TICKS = 15;
/** How long a stalled or wrong-category reward is skipped. */
const REWARD_COOLDOWN_MS = 30 * 60 * 1000;
/** Progress refresh for queued rewards that are not being watched. */
const REWARD_QUEUE_REFRESH_MS = 5 * 60 * 1000;
const REWARD_CLAIM_RETRY_MS = 5 * 60 * 1000;

interface ActiveReward {
  entry: RewardQueueEntry;
  /** Pinned: mined before game drops. Otherwise only while game mining is idle. */
  preempt: boolean;
  /** Channel watched for it: fixed for creator badges, picked for reward campaigns. */
  channelId: string;
  channelLogin: string;
  broadcastId: string | null;
  gameName: string;
  lastMinutes: number;
  stallTicks: number;
  watchFailures: number;
}

type StatusCallback = (userId: number, status: MinerStatus) => void;
type SettingsPersistCallback = (partial: Partial<MinerSettings>) => void;
type LogsPersistCallback = (logs: MinerLogEntry[]) => void;
type ClaimedDropsPersistCallback = (ids: Set<string>) => void;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sameLogin(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export class MinerWorker {
  private running = false;
  private state: MinerState = "IDLE";
  private message = "Idle";
  private allCampaigns: CampaignInfo[] = [];
  private miningCampaigns: CampaignInfo[] = [];
  private channels: ChannelInfo[] = [];
  private watching: ChannelInfo | null = null;
  private broadcastId: string | null = null;
  private currentDrop: DropProgress | null = null;
  /**
   * Raw `dropCurrentSession` counter for the channel we are watching.
   *
   * Twitch serves exactly one drop session per channel and it is not necessarily
   * a drop from the campaign we are mining. Keep it apart from `currentDrop`: it
   * is only the "watch time is being credited" signal.
   */
  private watchSession:
    | { dropId: string; currentMinutes: number; requiredMinutes: number }
    | null = null;
  /** Session drops that belong to no known campaign — logged once each. */
  private untrackedSessionDropIds = new Set<string>();
  private logs: MinerLogEntry[] = [];
  private pubsub: PubSubPool | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private loopPromise: Promise<void> | null = null;
  private channelTopicsSubscribed = new Set<string>();
  private lastWatchAt: string | null = null;
  private lastWatchMinutes: number | null = null;
  private consecutiveWatchFailures = 0;
  private consecutiveStallTicks = 0;
  private wsConnections = 0;
  private settings: MinerSettings;
  private switching = false;
  private lastInventoryRefresh = 0;
  private lastChannelRefresh = 0;
  private inventoryRefreshing = false;
  private forceInventoryRefresh = false;
  private lastCampaignCount = -1;
  private claiming = false;
  private claimFailures = new Map<string, number>();
  private watchGraceUntil = 0;
  private watchInFlight = false;
  private maintenanceTriggers: number[] = [];
  /** Campaign Twitch never lists in AvailableDrops — skip re-probing it. */
  private unlistedCampaignId: string | null = null;
  private claimedDropIds: Set<string>;
  private reward: ActiveReward | null = null;
  private rewardSwitching = false;
  private rewardProgress = new Map<string, RewardProgress>();
  private rewardCooldownUntil = new Map<string, number>();
  private rewardClaimAttemptAt = new Map<string, number>();
  private lastRewardQueueRefresh = 0;
  private rewardProgressErrorAt = 0;

  constructor(
    private userId: number,
    private auth: TwitchAuthSession,
    settings: MinerSettings,
    private onStatus: StatusCallback,
    private onSettingsPersist: SettingsPersistCallback = () => undefined,
    initialLogs: MinerLogEntry[] = [],
    private onLogsPersist: LogsPersistCallback = () => undefined,
    initialClaimedDropIds: Set<string> = new Set(),
    private onClaimedDropsPersist: ClaimedDropsPersistCallback = () => undefined
  ) {
    this.settings = { ...settings };
    this.logs = [...initialLogs];
    this.claimedDropIds = new Set(initialClaimedDropIds);
  }

  /** Switch focused campaign (pinned until finished, or null for priority auto). */
  async applyCampaignFocus() {
    if (!this.running) return;

    this.validatePinnedCampaign();

    const focused = this.resolveFocusedCampaign();
    if (this.settings.activeCampaignId && focused) {
      this.addLog("info", `Mining campaign: ${focused.name} (${focused.gameName})`);
    } else if (!this.settings.activeCampaignId && focused) {
      this.addLog("info", `Mining priority campaign: ${focused.name} (${focused.gameName})`);
    }

    this.watching = null;
    this.broadcastId = null;
    this.currentDrop = null;
    this.watchSession = null;
    this.settings.manualChannelLogin = null;

    if (!focused) {
      await this.rebuildChannelsFromMining();
      this.enterIdleState();
      this.emit();
      return;
    }

    this.state = "CHANNEL_SWITCH";
    this.message = `Switching to ${focused.gameName}…`;
    this.emit();

    await this.buildFocusedChannelList(focused);
    const best = pickBestChannel(
      this.getDisplayChannels(),
      this.getFocusedCampaigns(),
      null,
      null,
      this.settings.priorityGames
    );
    if (best) {
      await this.applyChannelSwitch(best.login);
    } else {
      await this.maintainWatching();
    }
    this.emit();
  }

  /** Discover live streams, verify drops, keep only campaign-eligible channels. */
  private async buildFocusedChannelList(focused: CampaignInfo) {
    const merged: ChannelInfo[] = [...focused.channels];
    if (focused.gameSlug) {
      merged.push(...(await discoverGameChannels(this.auth, focused.gameSlug, focused.id)));
    }

    this.channels = mergeChannels(merged).slice(0, MAX_CHANNELS);
    this.channels = await enrichChannelsOnline(this.auth, this.channels);
    await this.resolveChannelIds(
      this.channels.filter((c) => c.online && (!c.id || !/^\d+$/.test(c.id)))
    );
    await this.markChannelDropFlags(true);
    this.pruneChannelsWithoutDrops();
    this.ensureWatchingInChannelList();
    for (const ch of this.channels) this.subscribeChannel(ch);
  }

  /**
   * Ask Twitch which of the candidate channels serve the focused campaign.
   *
   * The answer is advisory only — see checkChannelCampaignDrops. Channels are
   * excluded solely when Twitch reports no viewer drop campaigns at all;
   * "not listed" leaves the channel unverified (undefined) so it stays a
   * candidate. Only the top channels are probed: the flag is a preference
   * signal, not a gate, so probing all ~100 directory results is wasted calls.
   *
   * Many campaigns are never listed by Twitch at all. Once a full probe comes
   * back with zero confirmations, remember that and skip the GQL calls on the
   * routine 5-minute refresh; `force` re-checks on a real rebuild (focus change
   * or inventory reload).
   */
  private async markChannelDropFlags(force = false) {
    const focused = this.getFocusedCampaigns();
    if (focused.length === 0) return;

    for (const ch of this.channels) {
      if (!ch.online || !ch.id || !/^\d+$/.test(ch.id)) ch.dropsEnabled = false;
    }

    const focusedId = focused[0]?.id ?? null;
    if (!force && focusedId !== null && this.unlistedCampaignId === focusedId) return;

    const probes = this.channels
      .filter((c) => c.online && c.id && /^\d+$/.test(c.id))
      .sort((a, b) => b.viewers - a.viewers)
      .slice(0, DROP_CHECK_CHANNELS);

    let confirmed = 0;
    let none = 0;
    const concurrency = 5;
    for (let i = 0; i < probes.length; i += concurrency) {
      const batch = probes.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (ch) => {
          const check = await checkChannelCampaignDrops(this.auth, ch.id, focused);
          if (check === "confirmed") {
            ch.dropsEnabled = true;
            confirmed++;
          } else if (check === "none") {
            ch.dropsEnabled = false;
            none++;
          } else {
            ch.dropsEnabled = undefined;
          }
        })
      );
    }

    if (probes.length > 0 && confirmed === 0 && none < probes.length) {
      // Log once per campaign — this is a standing property of the campaign,
      // not an event, and it would otherwise repeat on every channel refresh.
      if (focusedId !== null && this.unlistedCampaignId !== focusedId) {
        this.unlistedCampaignId = focusedId;
        this.addLog(
          "info",
          `Twitch does not list "${focused[0].name}" on any channel — using drops-enabled directory results`
        );
      }
    } else if (confirmed > 0 && focusedId !== null && this.unlistedCampaignId === focusedId) {
      this.unlistedCampaignId = null;
    }
  }

  /** Candidate channels for the focused campaign (UI + mining). */
  private getDisplayChannels(): ChannelInfo[] {
    return this.channels.filter((c) => c.dropsEnabled !== false);
  }

  private pruneChannelsWithoutDrops() {
    this.channels = this.channels.filter((c) => c.dropsEnabled !== false);
  }

  private async resolveChannelIds(channels: ChannelInfo[]) {
    const concurrency = 10;
    for (let i = 0; i < channels.length; i += concurrency) {
      await Promise.all(
        channels.slice(i, i + concurrency).map(async (ch) => {
          if (ch.id && /^\d+$/.test(ch.id)) return;
          try {
            const info = await fetchStreamInfo(this.auth, ch.login);
            if (info.channelId) ch.id = info.channelId;
            ch.online = info.online;
            ch.viewers = info.viewers;
            if (info.gameName) ch.gameName = info.gameName;
            if (info.gameSlug) ch.gameSlug = info.gameSlug;
            if (info.gameId) ch.gameId = info.gameId;
          } catch {
            ch.online = false;
          }
        })
      );
    }
  }

  private validatePinnedCampaign() {
    if (
      this.settings.activeCampaignId &&
      !this.miningCampaigns.some((c) => c.id === this.settings.activeCampaignId)
    ) {
      this.addLog("warn", "Pinned campaign is no longer available — using priority");
      this.clearPinnedCampaign();
    }
  }

  private clearPinnedCampaign() {
    if (!this.settings.activeCampaignId) return;
    this.settings.activeCampaignId = null;
    this.onSettingsPersist({ activeCampaignId: null });
  }

  private resolveFocusedCampaign(): CampaignInfo | null {
    return resolveFocusedCampaign(this.miningCampaigns, this.settings.activeCampaignId);
  }

  private getFocusedCampaigns(): CampaignInfo[] {
    const focused = this.resolveFocusedCampaign();
    return focused ? [focused] : [];
  }

  updateSettings(settings: Partial<MinerSettings>) {
    this.settings = { ...this.settings, ...settings };
  }

  /** Re-filter campaigns and rebuild channels — no full Twitch inventory fetch. */
  async applyMiningRules() {
    if (!this.running) return;

    const prevFocusedId = this.resolveFocusedCampaign()?.id ?? null;
    this.refilterMiningCampaigns();
    this.enforceDropListOnWatch();

    if (this.allCampaigns.length === 0) {
      this.addLog("info", "Drop lists saved — use Reload miner to fetch campaigns from Twitch");
      this.emit();
      return;
    }

    if (this.miningCampaigns.length === 0) {
      this.channels = [];
      this.clearWatchSession("Drop lists updated — no campaigns to mine");
      this.enterIdleState(true);
      this.emit();
      return;
    }

    const gameCount = new Set(this.miningCampaigns.map((c) => c.gameName)).size;
    this.addLog(
      "info",
      `Drop lists applied — ${gameCount} game(s), ${this.miningCampaigns.length} campaign(s)`
    );

    const nextFocusedId = this.resolveFocusedCampaign()?.id ?? null;
    const focusChanged = prevFocusedId !== nextFocusedId;
    if (!focusChanged && this.channels.length > 0 && this.watching && this.watchingAllowedByDropLists()) {
      await this.maintainWatching();
      this.emit();
      return;
    }

    await this.rebuildChannelsFromMining();
    await this.maintainWatching();
    if (!this.watching && this.miningCampaigns.length > 0) {
      // Channels may come online later — stay idle until maintainWatching finds one
      this.enterIdleState(true);
    } else if (this.miningCampaigns.length === 0) {
      this.enterIdleState(true);
    }
    this.emit();
  }

  /** Refresh campaign list from Twitch without drop-detail fetch or channel rebuild (Drop lists page). */
  async refreshCampaignSummaries() {
    if (!this.running) return;
    invalidateCampaignSourceCache(this.auth.userId);
    const prevMiningCount = this.miningCampaigns.length;
    const wasWatching = Boolean(this.watching?.login && this.broadcastId);
    const quick = await fetchInventory(this.auth, { quick: true });
    this.applyInventoryList(quick);

    if (this.miningCampaigns.length > prevMiningCount && !this.watching) {
      await this.resumeMiningIfEligible("New campaigns available — starting mining");
    } else if (this.miningCampaigns.length > 0 && wasWatching) {
      if (!this.watching || !this.broadcastId) {
        await this.maintainWatching();
      } else {
        this.setWatchingState(this.watching.login);
        await this.syncDropProgress();
      }
    } else if (this.miningCampaigns.length === 0 && !this.watching) {
      this.enterIdleState();
    } else if (this.watching && this.broadcastId) {
      this.setWatchingState(this.watching.login);
    }
    this.emit();
  }

  async switchToChannel(login: string) {
    if (!this.running || this.switching) return;
    this.settings.manualChannelLogin = login;
    await this.applyChannelSwitch(login, true);
  }

  /** Full inventory + channel rebuild — same as TDM "Reload". */
  async reloadInventory() {
    if (!this.running) return;
    this.forceInventoryRefresh = true;
    await this.refreshInventory();
  }

  getStatus(): MinerStatus {
    const rewardQueue = this.rewardViews();
    const rewardMining = this.reward
      ? rewardQueue.find((v) => v.id === this.reward!.entry.id) ?? null
      : null;
    const focused = this.resolveFocusedCampaign();
    const activeMining = computeActiveMining(
      this.allCampaigns,
      this.currentDrop,
      this.watching?.gameName ?? null,
      this.lastWatchAt
    );
    let unclaimedDrops = 0;
    for (const c of this.allCampaigns) {
      if (c.linked) continue;
      for (const d of c.drops) {
        if (!d.isClaimed && d.isComplete && !d.canClaim) unclaimedDrops++;
      }
    }
    return {
      state: rewardMining ? "WATCHING" : this.state,
      message: rewardMining
        ? `Watching ${rewardMining.watchingChannel} for "${rewardMining.rewardName}"`
        : this.message,
      watchingChannel: rewardMining ? rewardMining.watchingChannel : this.watching?.login ?? null,
      watchingGame: rewardMining ? this.reward?.gameName || null : this.watching?.gameName ?? null,
      currentDrop: rewardMining ? null : this.currentDrop,
      activeMining: rewardMining ? null : activeMining,
      campaigns: this.allCampaigns,
      // Candidate channels are useful only while the miner is actively
      // searching or watching. Do not show a previous campaign's list while
      // the worker is idle.
      channels: this.state === "IDLE" && !this.watching ? [] : this.getDisplayChannels(),
      logs: this.logs,
      websocketConnections: this.wsConnections,
      lastWatchAt: this.lastWatchAt,
      updatedAt: new Date().toISOString(),
      activeCampaignId: this.settings.activeCampaignId,
      focusedCampaignId: focused?.id ?? null,
      focusedCampaignName: focused?.name ?? null,
      focusedGameName: focused?.gameName ?? null,
      miningCampaignOptions: this.miningCampaigns.map((c) => ({
        id: c.id,
        name: c.name,
        gameName: c.gameName,
        gameImageUrl: c.gameImageUrl,
      })),
      unclaimedDrops,
      rewardQueue,
      pinnedRewardId: this.settings.pinnedRewardId,
      rewardMining,
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.addLog("info", "Miner started");
    rewardDirectory.track(this.settings.rewardQueue.map((e) => e.channelId));
    this.setupPubSub();
    this.loopPromise = this.runLoop();
    this.startWatchLoop();
    void this.refreshInventory();
    this.emit();
  }

  async stop() {
    this.running = false;
    this.reward = null;
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.pubsub?.stop();
    this.pubsub = null;
    this.state = "STOPPED";
    this.message = "Stopped";
    this.addLog("info", "Miner stopped");
    this.emit();
  }

  private markDropClaimed(dropId: string) {
    this.claimedDropIds.add(dropId);
    this.onClaimedDropsPersist(this.claimedDropIds);
  }

  /** Infer current drop from campaign inventory when Twitch session context is unavailable.
   *  Matches TDM first_drop: pick the earnable drop with fewest remaining minutes. */
  private inferCurrentDropFromCampaigns(requireProgress = true): DropProgress | null {
    const focused = this.resolveFocusedCampaign();
    if (!focused) return null;

    const earnable = focused.drops.filter(
      (d) =>
        !d.isClaimed && d.requiredMinutes > 0 && (!requireProgress || d.currentMinutes > 0)
    );
    if (earnable.length === 0) return null;

    // Pick drop closest to completion (fewest remaining minutes) — matches TDM first_drop
    earnable.sort(
      (a, b) =>
        (a.requiredMinutes - a.currentMinutes) - (b.requiredMinutes - b.currentMinutes)
    );
    const best = earnable[0];

    return {
      dropId: best.id,
      dropName: best.name,
      campaignId: focused.id,
      campaignName: focused.name,
      gameName: focused.gameName,
      imageUrl: best.imageUrl || focused.gameImageUrl,
      gameImageUrl: focused.gameImageUrl,
      currentMinutes: best.currentMinutes,
      requiredMinutes: best.requiredMinutes,
      isComplete: best.isComplete,
    };
  }

  /** Minutes on the live drop session, if Twitch has reported one for this channel. */
  private sessionMinutes(): number | undefined {
    return this.watchSession?.currentMinutes;
  }

  /** Twitch is crediting a drop we know nothing about — say so once, then re-check inventory. */
  private noteUntrackedSessionDrop(
    dropId: string,
    currentMinutes: number,
    requiredMinutes: number
  ) {
    if (this.untrackedSessionDropIds.has(dropId)) return;
    this.untrackedSessionDropIds.add(dropId);
    this.addLog(
      "info",
      `Twitch is crediting drop ${dropId} (${currentMinutes}/${requiredMinutes} min) from a campaign that is not in your inventory — showing the focused campaign instead`
    );
    this.forceInventoryRefresh = true;
  }

  /**
   * Pick the drop to present as "currently mining".
   *
   * `DropCurrentSessionContext` returns only an id and a minute counter — no name
   * and no campaign — and the drop it names can belong to a campaign we are not
   * mining, or one that is missing from the inventory entirely. Adopting it blindly
   * showed a bare UUID with that other campaign's required minutes (e.g. 188/480)
   * stitched onto the focused campaign's header. Only ever display a drop that
   * exists in the focused campaign; the session keeps its job as the watch signal.
   */
  private resolveDisplayDrop(
    sessionDropId: string,
    sessionDrop: DropProgress | null
  ): DropProgress | null {
    const focused = this.resolveFocusedCampaign();
    const found = findDropInCampaigns(this.allCampaigns, sessionDropId);
    if (found && (!focused || found.campaign.id === focused.id)) return sessionDrop;
    // Not the campaign we are mining: fall back to the focused campaign's own
    // next drop. Progress on it lands with the next inventory refresh.
    const inferred = this.inferCurrentDropFromCampaigns(false);
    if (inferred) return inferred;
    return found ? sessionDrop : null;
  }

  private addLog(level: MinerLogEntry["level"], message: string) {
    this.logs = [
      { time: new Date().toISOString(), level, message },
      ...this.logs,
    ].slice(0, MAX_MINER_LOGS);
    this.onLogsPersist(this.logs);
  }

  private emit() {
    this.onStatus(this.userId, this.getStatus());
  }

  private setWatchingState(login: string) {
    if (this.state !== "WATCHING" || this.message !== `Watching ${login}`) {
      this.state = "WATCHING";
      this.message = `Watching ${login}`;
    }
  }

  private setupPubSub() {
    this.pubsub = new PubSubPool(this.auth.accessToken, () => {
      this.wsConnections = this.pubsub?.connectionCount ?? 0;
      this.emit();
    });

    this.pubsub.addTopics(
      userTopics(this.auth.userId, {
        onDrops: (msg) => this.handleDropEvent(msg),
        onNotifications: () => {
          this.forceInventoryRefresh = true;
          this.addLog("info", "Twitch notification — scheduling inventory refresh");
        },
      })
    );
  }

  private handleDropEvent(msg: Record<string, unknown>) {
    const parsed = parseDropProgress(msg);
    if (!parsed || !parsed.dropId) return;

    if (parsed.type === "drop-claim") {
      const found = findDropInCampaigns(this.allCampaigns, parsed.dropId);
      if (found && parsed.dropInstanceId) {
        found.drop.claimId = parsed.dropInstanceId;
      }
      void this.tryClaimDrop(parsed.dropId, parsed.dropInstanceId ?? undefined);
      return;
    }

    if (parsed.type === "drop-progress") {
      const prevMinutes =
        this.watchSession?.currentMinutes ?? this.currentDrop?.currentMinutes ?? -1;
      updateDropMinutesInCampaigns(
        this.allCampaigns,
        parsed.dropId,
        parsed.currentMinutes,
        parsed.requiredMinutes
      );
      const progress = applyDropProgress(
        this.allCampaigns,
        parsed.dropId,
        parsed.currentMinutes,
        parsed.requiredMinutes
      );
      const required =
        parsed.requiredMinutes ||
        findDropInCampaigns(this.allCampaigns, parsed.dropId)?.drop.requiredMinutes ||
        0;
      if (!progress) {
        this.noteUntrackedSessionDrop(parsed.dropId, parsed.currentMinutes, required);
      }
      // Same counter `dropCurrentSession` reports, so keep the watch signal in
      // step with it even when the drop is not one we can display.
      this.watchSession = {
        dropId: parsed.dropId,
        currentMinutes: parsed.currentMinutes,
        requiredMinutes: required || this.watchSession?.requiredMinutes || 0,
      };
      this.currentDrop = this.resolveDisplayDrop(parsed.dropId, progress) ?? this.currentDrop;
      if (parsed.currentMinutes > prevMinutes) {
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = parsed.currentMinutes;
      }
      if (progress && required > 0 && parsed.currentMinutes >= required) {
        void this.onDropWatchComplete(parsed.dropId, parsed.dropInstanceId);
      }
      this.emit();
    }
  }

  /** Watch time finished — claim immediately and refresh inventory if needed (TDM drop-claim + GAMES_UPDATE). */
  private async onDropWatchComplete(dropId: string, dropInstanceId?: string) {
    if (!this.running) return;
    await this.syncDropProgress();
    const found = findDropInCampaigns(this.allCampaigns, dropId);
    if (found?.drop.isClaimed) {
      this.claimFailures.delete(dropId);
      await this.afterDropClaimed(dropId, found.campaign);
      return;
    }
    await this.tryClaimDrop(dropId, dropInstanceId);
    const after = findDropInCampaigns(this.allCampaigns, dropId);
    if (after && !after.drop.isClaimed) {
      this.forceInventoryRefresh = true;
    } else {
      this.claimFailures.delete(dropId);
    }
  }

  private claimWatchCompletedDrops() {
    if (this.claiming || this.inventoryRefreshing) return;
    const dropId = this.currentDrop?.dropId;
    if (!dropId) return;
    const found = findDropInCampaigns(this.allCampaigns, dropId);
    if (!found || found.drop.isClaimed) return;

    // Only claim when Twitch explicitly says it's claimable (via canClaim flag or drop-claim websocket message)
    // This prevents premature claim attempts at 599/600 minutes
    if (dropCanClaim(found.drop, found.campaign)) {
      void this.onDropWatchComplete(dropId, found.drop.claimId);
    }
  }

  private subscribeChannel(ch: ChannelInfo) {
    if (!ch.id || ch.id.startsWith("pending-") || this.channelTopicsSubscribed.has(ch.id)) return;
    this.channelTopicsSubscribed.add(ch.id);
    this.pubsub?.addTopics(
      channelTopics(ch.id, {
        onStreamState: (msg) => {
          const type = msg.type as string;
          if (type === "stream-down" && sameLogin(this.watching?.login, ch.login)) {
            this.addLog("warn", `Channel ${ch.login} went offline`);
            this.watching = null;
            this.broadcastId = null;
            this.enterIdleState();
          } else if (type === "stream-up") {
            setTimeout(() => this.refreshChannelOnline(ch.login), ONLINE_DELAY_MS);
          } else if (type === "viewcount") {
            const viewers = Number((msg as Record<string, unknown>).viewers ?? 0);
            const target = this.channels.find((c) => sameLogin(c.login, ch.login));
            if (target) {
              target.viewers = viewers;
              this.emit();
            }
          }
        },
        onStreamUpdate: () => {
          setTimeout(() => this.refreshChannelOnline(ch.login), ONLINE_DELAY_MS);
        },
      })
    );
  }

  private async refreshChannelOnline(login: string) {
    try {
      const info = await fetchStreamInfo(this.auth, login);
      const ch = this.channels.find((c) => sameLogin(c.login, login));
      if (ch) {
        ch.online = info.online;
        ch.viewers = info.viewers;
        if (info.gameName) ch.gameName = info.gameName;
        if (info.channelId) ch.id = info.channelId;
      }
      if (sameLogin(this.watching?.login, login)) {
        if (info.online && info.broadcastId) {
          this.broadcastId = info.broadcastId;
          if (this.watching) this.watching.online = true;
          this.setWatchingState(login);
        } else {
          this.broadcastId = null;
        }
      } else if (
        sameLogin(this.settings.manualChannelLogin, login) &&
        info.online &&
        info.broadcastId &&
        !this.switching
      ) {
        await this.applyChannelSwitch(login);
      }
      this.emit();
    } catch {
      /* ignore */
    }
  }

  private upsertChannel(login: string, info: Awaited<ReturnType<typeof fetchStreamInfo>>): ChannelInfo {
    let ch = this.channels.find((c) => sameLogin(c.login, login));
    if (!ch) {
      ch = {
        id: info.channelId ?? login,
        login,
        displayName: login,
        gameName: info.gameName,
        gameSlug: info.gameSlug,
        gameId: info.gameId,
        online: info.online,
        viewers: info.viewers,
        campaignIds: [],
        aclPreferred: false,
      };
      this.channels.push(ch);
    } else {
      ch.online = info.online;
      ch.viewers = info.viewers;
      if (info.channelId) ch.id = info.channelId;
      if (info.online) {
        ch.gameName = info.gameName;
        ch.gameSlug = info.gameSlug;
        ch.gameId = info.gameId;
      } else {
        ch.gameName = "";
        ch.gameSlug = "";
        ch.gameId = "";
      }
    }
    return ch;
  }

  private ensureWatchingInChannelList() {
    if (!this.watching) return;
    if (this.watching.dropsEnabled === false) return;
    const exists = this.channels.some((c) => sameLogin(c.login, this.watching!.login));
    if (!exists) {
      this.channels.unshift({ ...this.watching });
    }
  }

  private async applyChannelSwitch(login: string, userInitiated = false) {
    if (this.reward?.preempt) {
      // A pinned reward owns the watch slot; only an explicit switch overrides it.
      if (!userInitiated) return;
      this.addLog("info", `Unpinned "${this.reward.entry.rewardName}" — switching to ${login}`);
      this.settings.pinnedRewardId = null;
      this.onSettingsPersist({ pinnedRewardId: null });
      this.stopReward();
    }

    if (
      !userInitiated &&
      sameLogin(this.watching?.login, login) &&
      this.broadcastId &&
      this.watching?.online
    ) {
      this.setWatchingState(login);
      return;
    }

    this.switching = true;
    try {
      if (userInitiated || !sameLogin(this.watching?.login, login)) {
        this.addLog("info", `Switching to channel ${login}`);
      }

      const info = await fetchStreamInfo(this.auth, login);
      const ch = this.upsertChannel(login, info);
      this.watching = ch;
      // Each channel gets its own drop session — never carry the last one over.
      this.watchSession = null;

      const focused = this.getFocusedCampaigns();
      const needGame = focused.map((c) => c.gameName).filter(Boolean);
      const gameOk = channelMatchesCampaigns(ch, focused);
      if (!gameOk && needGame.length > 0) {
        const msg = `${login} streams "${info.gameName || "unknown"}" — drops need ${needGame.join(" or ")}`;
        if (!userInitiated) {
          this.addLog("warn", msg);
          this.watching = null;
          this.broadcastId = null;
          this.emit();
          return;
        }
        this.addLog("warn", msg);
      }

      // Verify only when we have no verdict yet, and skip the channel only if
      // Twitch reports it serves no drop campaigns at all. "Campaign not listed"
      // is inconclusive (see checkChannelCampaignDrops) and must not block.
      if (!userInitiated && focused.length > 0 && ch.dropsEnabled === undefined) {
        const check =
          ch.id && /^\d+$/.test(ch.id)
            ? await checkChannelCampaignDrops(this.auth, ch.id, focused)
            : "unknown";
        if (check === "confirmed") ch.dropsEnabled = true;
        if (check === "none") {
          ch.dropsEnabled = false;
          this.addLog("warn", `${login} has no drop campaigns active — skipping`);
          this.watching = null;
          this.broadcastId = null;
          this.emit();
          return;
        }
      }

      if (info.online && info.broadcastId) {
        this.broadcastId = info.broadcastId;
        this.setWatchingState(login);
        this.subscribeChannel(ch);
        if (this.reward) {
          this.stopReward(`Game drops available on ${login} — pausing "${this.reward.entry.rewardName}"`);
        }


        await this.syncDropProgress();
        if (!this.currentDrop) {
          this.currentDrop = this.inferCurrentDropFromCampaigns();
        }
        this.consecutiveStallTicks = 0;
        this.consecutiveWatchFailures = 0;
        this.watchGraceUntil = Date.now() + 65_000;
        const startMinutes = this.sessionMinutes() ?? this.currentDrop?.currentMinutes;
        if (startMinutes !== undefined) {
          this.lastWatchMinutes = startMinutes;
        }
        void this.performWatch();
        if (userInitiated || !sameLogin(this.watching?.login, login)) {
          this.addLog("success", `Now watching ${login} (${info.gameName || "no game tag"})`);
        }
      } else {
        this.broadcastId = null;
        this.enterIdleState();
        if (userInitiated) {
          this.addLog("warn", `${login} is offline — will watch when live`);
        }
      }
      this.ensureWatchingInChannelList();
      this.emit();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Switch failed";
      this.addLog("error", `Channel switch failed: ${msg}`);
      this.state = "ERROR";
      this.message = msg;
      this.emit();
    } finally {
      this.switching = false;
    }
  }

  private async runLoop() {
    while (this.running) {
      try {
        await this.loopIteration();
      } catch (err) {
        this.state = "ERROR";
        this.message = err instanceof Error ? err.message : "Unknown error";
        this.addLog("error", this.message);
        this.emit();
      }
      await new Promise((r) => setTimeout(r, LOOP_INTERVAL_MS));
    }
  }

  private async loopIteration() {
    const now = Date.now();

    const maintenanceDue = this.isInventoryMaintenanceDue(now);
    const idleRefreshDue = this.isIdleInventoryRefreshDue(now);
    if (
      (this.forceInventoryRefresh ||
        this.allCampaigns.length === 0 ||
        maintenanceDue ||
        idleRefreshDue) &&
      !this.inventoryRefreshing
    ) {
      if (
        maintenanceDue &&
        !this.forceInventoryRefresh &&
        this.allCampaigns.length > 0
      ) {
        this.addLog("info", "Scheduled inventory refresh (hourly check for new campaigns)");
        this.forceInventoryRefresh = true;
      } else if (idleRefreshDue && !this.forceInventoryRefresh) {
        this.addLog("info", "Scheduled inventory refresh (idle check for new campaigns)");
        this.forceInventoryRefresh = true;
      }
      await this.refreshInventory();
    } else if (now - this.lastChannelRefresh >= CHANNEL_REFRESH_MS) {
      await this.refreshChannelsQuietly();
      this.lastChannelRefresh = now;
    }

    await this.claimWatchCompletedDrops();
    await this.maintainWatching();
    await this.refreshQueuedRewardProgress();
    await this.maintainReward();
  }

  /** TDM maintenance_task — campaign/drop start/end within the next hour, or hourly reload. */
  private isInventoryMaintenanceDue(now: number): boolean {
    if (this.lastInventoryRefresh <= 0) return false;
    if (now - this.lastInventoryRefresh >= INVENTORY_MAINTENANCE_MS) return true;
    while (this.maintenanceTriggers.length > 0 && this.maintenanceTriggers[0] <= now) {
      this.maintenanceTriggers.shift();
      return true;
    }
    return false;
  }

  /** Keep idle users responsive to newly opened drops without interrupting active mining. */
  private isIdleInventoryRefreshDue(now: number): boolean {
    return (
      this.miningCampaigns.length === 0 &&
      !this.watching &&
      this.lastInventoryRefresh > 0 &&
      now - this.lastInventoryRefresh >= IDLE_INVENTORY_REFRESH_MS
    );
  }

  private scheduleMaintenanceTriggers() {
    const now = Date.now();
    const nextHour = now + INVENTORY_MAINTENANCE_MS;
    const triggers = new Set<number>([nextHour]);

    for (const campaign of this.allCampaigns) {
      for (const ts of [campaign.startsAt, campaign.endsAt]) {
        const t = Date.parse(ts);
        if (Number.isFinite(t) && t > now && t <= nextHour) triggers.add(t);
      }
      for (const drop of campaign.drops) {
        const t = Date.parse(drop.endsAt);
        if (Number.isFinite(t) && t > now && t <= nextHour) triggers.add(t);
      }
    }

    this.maintenanceTriggers = [...triggers].sort((a, b) => a - b);
  }

  private async resumeMiningIfEligible(reason: string) {
    if (this.miningCampaigns.length === 0 || this.watching) return;
    this.addLog("info", reason);
    await this.rebuildChannelsFromMining();
    await this.maintainWatching();
  }

  private applyInventoryList(campaigns: CampaignInfo[]) {
    const merged = mergeCampaignProgress(this.allCampaigns, campaigns);
    this.restoreConfirmedClaims(merged);
    this.allCampaigns = finalizeCampaigns(merged);
    this.refilterMiningCampaigns();
    this.scheduleMaintenanceTriggers();
  }

  /**
   * Twitch can briefly omit isClaimed from a fresh inventory response after a
   * successful ClaimDrop mutation. Restore only claims this worker confirmed;
   * watched minutes alone must never be treated as a claim.
   */
  private restoreConfirmedClaims(campaigns: CampaignInfo[]) {
    if (this.claimedDropIds.size === 0) return;

    for (const campaign of campaigns) {
      for (const drop of campaign.drops) {
        if (!this.claimedDropIds.has(drop.id)) continue;
        drop.isClaimed = true;
        drop.isComplete = true;
        drop.canClaim = false;
        if (drop.requiredMinutes > 0) drop.currentMinutes = drop.requiredMinutes;
      }
    }
  }

  private async refreshInventory() {
    if (this.inventoryRefreshing) return;
    this.inventoryRefreshing = true;
    const force = this.forceInventoryRefresh;
    if (force) {
      invalidateCampaignSourceCache(this.auth.userId);
    }
    this.forceInventoryRefresh = false;

    try {
      this.state = "INVENTORY_FETCH";
      this.message = "Loading campaigns…";
      this.emit();

      const needQuick = this.allCampaigns.length === 0;
      if (needQuick) {
        const quick = await fetchInventory(this.auth, { quick: true });
        this.applyInventoryList(quick);

        if (this.allCampaigns.length !== this.lastCampaignCount) {
          this.addLog("info", `Loaded ${this.allCampaigns.length} campaign(s) (quick)`);
          this.lastCampaignCount = this.allCampaigns.length;
        }

        if (this.allCampaigns.length === 0) {
          this.lastInventoryRefresh = Date.now();
          if (this.miningCampaigns.length === 0 && !this.watching) {
            this.enterIdleState();
          }
          this.emit();
          return;
        }

        this.message = "Loading drop details…";
        this.emit();
      }

      const fetched = await fetchInventory(this.auth);
      const prevMiningCount = this.miningCampaigns.length;
      this.applyInventoryList(fetched);

      if (this.allCampaigns.length !== this.lastCampaignCount) {
        this.addLog("info", `Loaded ${this.allCampaigns.length} campaign(s) from Twitch`);
        this.lastCampaignCount = this.allCampaigns.length;
      }

      if (this.miningCampaigns.length > prevMiningCount && !this.watching) {
        await this.resumeMiningIfEligible("New earnable campaigns detected — starting mining");
      }

      await this.rebuildChannelsFromMining();
      await this.claimAllEligibleDrops();
      await this.checkStuckDrops();

      // After claiming, refilter to remove completed campaigns
      this.refilterMiningCampaigns();

      await this.syncDropProgress();
      await this.maintainWatching();
      this.lastInventoryRefresh = Date.now();
      this.lastChannelRefresh = Date.now();
      if (this.miningCampaigns.length === 0 && !this.watching) {
        this.enterIdleState();
      } else if (!this.watching && this.miningCampaigns.length > 0) {
        await this.maintainWatching();
      } else if (this.watching && this.broadcastId) {
        this.setWatchingState(this.watching.login);
      }
      this.emit();
    } finally {
      this.inventoryRefreshing = false;
    }
  }

  private async rebuildChannelsFromMining() {
    const focused = this.resolveFocusedCampaign();
    if (!focused) {
      this.channels = [];
      return;
    }
    await this.buildFocusedChannelList(focused);
  }

  private async refreshChannelsQuietly() {
    if (this.channels.length === 0) return;
    this.channels = await enrichChannelsOnline(this.auth, this.channels);
    await this.resolveChannelIds(
      this.channels.filter((c) => c.online && (!c.id || !/^\d+$/.test(c.id)))
    );
    await this.markChannelDropFlags();
    this.pruneChannelsWithoutDrops();
    this.ensureWatchingInChannelList();
    this.emit();
  }

  private refilterMiningCampaigns() {
    this.miningCampaigns = filterCampaignsForMining(
      this.allCampaigns,
      this.settings.excludeGames,
      this.settings.priorityGames,
      this.settings.priorityMode
    );
    this.validatePinnedCampaign();
    if (this.miningCampaigns.length === 0) this.channels = [];
  }

  private resolveIdleMessage(): string {
    if (this.settings.priorityMode === "PRIORITY_ONLY" && this.settings.priorityGames.length === 0) {
      return "Idle — add games to your priority list to start mining";
    }
    const anyEarnable = this.allCampaigns.some((c) => campaignHasEarnableDrops(c));
    if (!anyEarnable && this.allCampaigns.length > 0) {
      return "Idle — all campaigns complete, waiting for new drops";
    }
    if (this.miningCampaigns.length === 0 && this.allCampaigns.length > 0) {
      return "Idle — no earnable priority campaigns, waiting for new drops";
    }
    if (this.miningCampaigns.length > 0) {
      return "Idle — waiting for live channels with drops";
    }
    return "Idle — waiting for active campaigns";
  }

  private enterIdleState(clearSession = false) {
    const message = this.resolveIdleMessage();
    if (clearSession) {
      this.watching = null;
      this.broadcastId = null;
      this.currentDrop = null;
      this.watchSession = null;
    }
    if (this.state !== "IDLE" || this.message !== message) {
      this.state = "IDLE";
      this.message = message;
      this.emit();
    }
  }

  private async afterDropClaimed(
    dropId: string,
    campaign: CampaignInfo
  ): Promise<void> {
    this.refilterMiningCampaigns();

    const campaignFinished = !campaignHasEarnableDrops(campaign);

    if (campaignFinished) {
      this.addLog("info", `Campaign finished: ${campaign.name}`);
      if (this.currentDrop?.dropId === dropId) this.currentDrop = null;

      if (this.settings.activeCampaignId === campaign.id) {
        this.clearPinnedCampaign();
        this.addLog("info", "Pinned campaign complete — resuming priority selection");
      }

      if (this.miningCampaigns.length === 0) {
        this.enterIdleState(true);
        this.forceInventoryRefresh = true;
        void this.refreshInventory();
        return;
      }

      this.addLog("info", "Switching to next priority campaign");
      this.watching = null;
      this.broadcastId = null;
      this.currentDrop = null;
      this.watchSession = null;
      const next = this.resolveFocusedCampaign();
      if (next) {
        await this.buildFocusedChannelList(next);
        const best = pickBestChannel(
          this.getDisplayChannels(),
          this.getFocusedCampaigns(),
          null,
          null,
          this.settings.priorityGames
        );
        if (best) await this.applyChannelSwitch(best.login);
        else await this.maintainWatching();
      } else {
        await this.rebuildChannelsFromMining();
        await this.maintainWatching();
      }
      this.forceInventoryRefresh = true;
      return;
    }

    await this.waitForNextDrop(dropId);
    await this.syncDropProgress();

    if (
      this.watching &&
      this.getFocusedCampaigns().length > 0 &&
      !channelMatchesCampaigns(this.watching, this.getFocusedCampaigns())
    ) {
      this.addLog("info", "Current channel has no more earnable drops — switching");
      this.watching = null;
      this.broadcastId = null;
      await this.maintainWatching();
      return;
    }

    if (!this.currentDrop) {
      this.forceInventoryRefresh = true;
    }
  }

  private clearWatchSession(logMessage?: string) {
    if (logMessage) this.addLog("info", logMessage);
    this.watching = null;
    this.broadcastId = null;
    this.currentDrop = null;
    this.watchSession = null;
  }

  /** Whether the current channel still matches priority / ignore lists and mining campaigns. */
  private watchingAllowedByDropLists(): boolean {
    if (!this.watching) return false;

    if (this.miningCampaigns.length === 0) return false;

    const gameName = (this.watching.gameName ?? "").toLowerCase();
    const gameSlug = (this.watching.gameSlug ?? "").toLowerCase();

    if (
      gameName &&
      this.settings.excludeGames.some((g) => g.toLowerCase() === gameName)
    ) {
      return false;
    }

    if (this.settings.priorityMode === "PRIORITY_ONLY") {
      if (this.settings.priorityGames.length === 0) return false;
      if (
        gameName &&
        !this.settings.priorityGames.some((g) => g.toLowerCase() === gameName) &&
        !channelMatchesCampaigns(this.watching, this.miningCampaigns)
      ) {
        return false;
      }
    }

    // Stream category not resolved yet — don't force-stop while metadata loads
    if (!gameName && !gameSlug) return true;

    return channelMatchesCampaigns(this.watching, this.miningCampaigns);
  }

  private enforceDropListOnWatch() {
    if (!this.watching) return;
    if (this.watchingAllowedByDropLists()) return;
    const label = this.watching.gameName || this.watching.login;
    this.clearWatchSession(`Stopped watching ${label} — no longer allowed by drop lists`);
  }

  private async maintainWatching() {
    if (this.switching) return;
    if (this.reward?.preempt) {
      if (this.watching) {
        this.clearWatchSession(`Pinned "${this.reward.entry.rewardName}" — pausing game drops`);
      }
      return;
    }

    const focusedCampaigns = this.getFocusedCampaigns();
    const manual = this.settings.manualChannelLogin;

    if (this.miningCampaigns.length === 0) {
      if (this.watching) {
        this.clearWatchSession("No eligible campaigns — stopping watch");
      }
      this.enterIdleState(true);
      return;
    }

    this.enforceDropListOnWatch();

    if (manual) {
      const manualChannel = this.getDisplayChannels().find((c) => sameLogin(c.login, manual));
      if (focusedCampaigns.length > 0 && !manualChannel) {
        this.addLog("warn", `Manual channel ${manual} has no drops for this campaign`);
        this.settings.manualChannelLogin = null;
        this.onSettingsPersist({ manualChannelLogin: null });
      } else if (manualChannel) {
        if (sameLogin(this.watching?.login, manual) && this.broadcastId) {
          this.setWatchingState(manual);
          this.emit();
          return;
        }
        if (!sameLogin(this.watching?.login, manual)) {
          await this.applyChannelSwitch(manual);
        } else if (this.watching && !this.broadcastId) {
          const info = await fetchStreamInfo(this.auth, manual);
          if (info.online && info.broadcastId) {
            this.broadcastId = info.broadcastId;
            this.watching.online = true;
            if (info.channelId) this.watching.id = info.channelId;
            if (info.gameId) this.watching.gameId = info.gameId;
            this.setWatchingState(manual);
            await this.syncDropProgress();
            void this.performWatch();
            this.emit();
          }
        }
        return;
      }
    }

    if (this.watching && this.broadcastId) {
      const inList = this.channels.find((c) => sameLogin(c.login, this.watching!.login));
      if (inList?.online === false) {
        this.broadcastId = null;
        this.watching = null;
      } else if (
        focusedCampaigns.length > 0 &&
        !channelMatchesCampaigns(this.watching, focusedCampaigns)
      ) {
        const need = focusedCampaigns.map((c) => c.gameName).filter(Boolean).join(" or ");
        this.addLog(
          "warn",
          `${this.watching.login} streams "${this.watching.gameName || "unknown"}" — need ${need}`
        );
        this.broadcastId = null;
        this.watching = null;
      } else if (focusedCampaigns.length > 0 && inList?.dropsEnabled === false) {
        this.addLog("warn", `${this.watching.login} has no drop campaigns active — searching for another channel`);
        this.broadcastId = null;
        this.watching = null;
      } else if (focusedCampaigns.length === 0) {
        this.clearWatchSession("No focused campaign — stopping watch");
      } else {
        this.setWatchingState(this.watching.login);
        this.emit();
        return;
      }
    }

    const best = pickBestChannel(
      this.getDisplayChannels(),
      focusedCampaigns,
      null,
      this.watching?.login ?? null,
      this.settings.priorityGames
    );
    if (best) {
      await this.applyChannelSwitch(best.login);
    } else if (focusedCampaigns.length > 0) {
      let discovered = false;
      for (const campaign of focusedCampaigns) {
        if (!campaign.gameSlug) continue;
        const found = await discoverGameChannels(this.auth, campaign.gameSlug, campaign.id);
        if (found.length === 0) continue;
        this.channels = mergeChannels([...this.channels, ...found]).slice(0, MAX_CHANNELS);
        await this.resolveChannelIds(
          found.filter((c) => c.online && (!c.id || !/^\d+$/.test(c.id)))
        );
        await this.markChannelDropFlags();
        this.pruneChannelsWithoutDrops();
        discovered = true;
        const retry = pickBestChannel(
          this.getDisplayChannels(),
          focusedCampaigns,
          null,
          null,
          this.settings.priorityGames
        );
        if (retry) {
          await this.applyChannelSwitch(retry.login);
          break;
        }
      }
      if (!discovered && !this.watching) {
        this.enterIdleState();
      } else if (discovered && !this.watching) {
        this.enterIdleState();
      }
    } else if (!this.watching) {
      this.enterIdleState();
    }
  }

  private startWatchLoop() {
    if (this.watchTimer) clearInterval(this.watchTimer);
    void this.performWatch();
    let tick = 0;
    this.watchTimer = setInterval(() => {
      tick = (tick + 1) % PROGRESS_CHECK_TICKS;
      if (tick === 0) {
        void this.performWatch();
      } else if (this.reward?.broadcastId) {
        void sendWatchStream(this.auth, this.reward.channelLogin);
      } else if (this.watching && this.broadcastId) {
        void sendWatchStream(this.auth, this.watching.login);
      }
    }, WATCH_INTERVAL_MS);
  }

  /** TDM GAMES_UPDATE: claim all ready drops from inventory. */
  private async claimAllEligibleDrops() {
    if (this.claiming) return;
    for (const campaign of this.allCampaigns) {
      if (campaign.status === "EXPIRED") continue;
      for (const drop of campaign.drops) {
        if (!dropCanClaim(drop, campaign)) continue;
        await this.tryClaimDrop(drop.id);
      }
    }
  }

  private async checkStuckDrops() {
    const dropId = this.currentDrop?.dropId;
    if (!dropId) return;
    const found = findDropInCampaigns(this.allCampaigns, dropId);
    if (!found || found.drop.isClaimed) {
      this.claimFailures.delete(dropId);
      return;
    }
    const { drop, campaign } = found;
    if (drop.requiredMinutes > 0 && drop.currentMinutes >= drop.requiredMinutes && !drop.canClaim && !drop.claimId) {
      const failures = (this.claimFailures.get(dropId) ?? 0) + 1;
      this.claimFailures.set(dropId, failures);
      if (failures >= 3) {
        this.addLog("warn", `Could not claim drop: ${drop.name} (${campaign.gameName}) — skipping`);
        this.claimFailures.delete(dropId);
        drop.isComplete = true;
        this.currentDrop = null;
        await this.afterDropClaimed(dropId, campaign);
      }
    }
  }

  private async tryClaimDrop(dropId: string, dropInstanceId?: string) {
    const found = findDropInCampaigns(this.allCampaigns, dropId);
    if (!found || found.drop.isClaimed) return;

    const { drop, campaign } = found;
    if (dropInstanceId) drop.claimId = dropInstanceId;
    if (!dropCanClaim(drop, campaign)) return;

    const claimId = dropInstanceId ?? resolveClaimId(this.auth, drop, campaign.id);
    if (!claimId) return;

    if (this.claiming) return;
    this.claiming = true;
    try {
      this.addLog("info", `Claiming drop: ${drop.name} (${campaign.gameName})`);
      const ok = await claimDrop(this.auth, claimId);
      if (ok) {
        drop.isClaimed = true;
        drop.isComplete = true;
        drop.canClaim = false;
        if (drop.requiredMinutes > 0) {
          drop.currentMinutes = drop.requiredMinutes;
        }
        this.markDropClaimed(dropId);
        this.addLog(
          "success",
          `Claimed drop: ${drop.name} (${campaign.gameName}) (${campaign.drops.filter((d) => d.isClaimed).length}/${campaign.drops.length})`
        );
        await this.afterDropClaimed(dropId, campaign);
        this.emit();
      } else {
        this.addLog("warn", `Claim attempt failed: ${drop.name}`);
        this.forceInventoryRefresh = true;
      }
    } finally {
      this.claiming = false;
    }
  }

  /** After claim, poll until Twitch switches dropCurrentSession (TDM ~4s + up to 8×2s). */
  private async waitForNextDrop(previousDropId: string) {
    if (!this.watching?.id || !/^\d+$/.test(this.watching.id)) return;

    await new Promise((r) => setTimeout(r, 4000));

    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        if (!this.watching?.id || !/^\d+$/.test(this.watching.id)) return;
        const channelId = this.watching.id;
        const gql = new GqlClient(this.auth);
        const result = await gql.currentDrop(channelId);
        if (!this.watching || this.watching.id !== channelId) return;
        const session = asRecord(asRecord(asRecord(result.data).currentUser).dropCurrentSession);
        const newDropId = session?.dropID ? String(session.dropID) : "";
        if (!newDropId || newDropId !== previousDropId) {
          if (newDropId) {
            const currentMinutes = Number(session.currentMinutesWatched ?? 0);
            const requiredMinutes = Number(session.requiredMinutesWatched ?? 0);
            updateDropMinutesInCampaigns(
              this.allCampaigns,
              newDropId,
              currentMinutes,
              requiredMinutes
            );
            this.watchSession = { dropId: newDropId, currentMinutes, requiredMinutes };
            const found = findDropInCampaigns(this.allCampaigns, newDropId);
            if (!found) {
              this.noteUntrackedSessionDrop(newDropId, currentMinutes, requiredMinutes);
            }
            const sessionDrop = found
              ? this.buildDropProgressFromSession(
                  session,
                  newDropId,
                  currentMinutes,
                  requiredMinutes
                )
              : null;
            this.currentDrop = this.resolveDisplayDrop(newDropId, sessionDrop);
            if (this.currentDrop) {
              this.addLog(
                "info",
                `Now mining: ${this.currentDrop.dropName}${this.currentDrop.gameName ? ` (${this.currentDrop.gameName})` : ""}`
              );
            }
          }
          return;
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!this.currentDrop || this.currentDrop.dropId === previousDropId) {
      this.forceInventoryRefresh = true;
    }
  }

  private buildDropProgressFromSession(
    session: Record<string, unknown>,
    dropId: string,
    currentMinutes: number,
    requiredMinutes: number
  ): DropProgress {
    const fromCampaigns = applyDropProgress(this.allCampaigns, dropId, currentMinutes, requiredMinutes);
    if (fromCampaigns) return fromCampaigns;

    const drop = asRecord(session.drop);
    const campaign = asRecord(session.campaign ?? session.dropCampaign);
    const game = asRecord(session.game ?? campaign.game);
    const dropName = String(session.dropName ?? drop.name ?? dropId);
    const campaignName = String(session.campaignName ?? campaign.name ?? "");
    const campaignId = String(campaign.id ?? session.campaignID ?? session.campaignId ?? "");
    const gameName = String(game.displayName ?? game.name ?? this.watching?.gameName ?? "");

    const found = findDropInCampaigns(this.allCampaigns, dropId);
    const images = extractImagesFromSession(session);
    return {
      dropId,
      dropName: found?.drop.name ?? dropName,
      campaignId: found?.campaign.id ?? campaignId,
      campaignName: found?.campaign.name ?? campaignName,
      gameName: found?.campaign.gameName ?? gameName,
      imageUrl: found?.drop.imageUrl || images.dropImageUrl || found?.campaign.gameImageUrl || "",
      gameImageUrl: found?.campaign.gameImageUrl || images.gameImageUrl || "",
      currentMinutes,
      requiredMinutes,
      isComplete: requiredMinutes > 0 && currentMinutes >= requiredMinutes,
    };
  }

  private async ensureCampaignDrops(campaignId: string, activeDropId?: string) {
    if (!campaignId) return;
    const existing = this.allCampaigns.find((c) => c.id === campaignId);
    const needsFetch =
      !existing ||
      existing.drops.length === 0 ||
      Boolean(activeDropId && !existing.drops.some((d) => d.id === activeDropId));
    if (!needsFetch) return;

    const detail = await fetchCampaignDetail(this.auth, campaignId);
    if (!detail) return;

    if (existing) {
      const merged = mergeCampaignProgress([existing], [detail])[0];
      existing.drops = merged.drops;
      existing.name = detail.name || existing.name;
      existing.gameImageUrl = detail.gameImageUrl || existing.gameImageUrl;
    } else {
      this.allCampaigns.push(detail);
    }
  }

  private async syncDropProgress() {
    if (!this.watching?.id || !/^\d+$/.test(this.watching.id)) return false;
    try {
      const gql = new GqlClient(this.auth);
      const result = await gql.currentDrop(this.watching.id);
      const session = asRecord(asRecord(asRecord(result.data).currentUser).dropCurrentSession);
      if (!session || !session.dropID) return false;

      const dropId = String(session.dropID);
      const currentMinutes = Number(session.currentMinutesWatched ?? 0);
      const requiredMinutes = Number(session.requiredMinutesWatched ?? 0);

      const prevDropId = this.watchSession?.dropId;
      this.watchSession = { dropId, currentMinutes, requiredMinutes };
      if (prevDropId && prevDropId !== dropId) {
        const prev = findDropInCampaigns(this.allCampaigns, prevDropId);
        if (prev) {
          if (!prev.drop.isClaimed && prev.drop.requiredMinutes > 0 && prev.drop.currentMinutes >= prev.drop.requiredMinutes) {
            prev.drop.isClaimed = true;
            prev.drop.isComplete = true;
            prev.drop.canClaim = false;
            this.markDropClaimed(prevDropId);
            this.addLog(
              "success",
              `Drop claimed: ${prev.drop.name} (${prev.campaign.gameName}) (${prev.campaign.drops.filter((d) => d.isClaimed).length}/${prev.campaign.drops.length})`
            );
          }
        }
      }

      const campaignRaw = asRecord(session.campaign ?? session.dropCampaign);
      const campaignId = String(campaignRaw.id ?? session.campaignID ?? session.campaignId ?? "");
      if (campaignId) await this.ensureCampaignDrops(campaignId, dropId);

      updateDropMinutesInCampaigns(this.allCampaigns, dropId, currentMinutes, requiredMinutes);

      const sessionDrop = findDropInCampaigns(this.allCampaigns, dropId)
        ? this.buildDropProgressFromSession(session, dropId, currentMinutes, requiredMinutes)
        : null;
      if (!sessionDrop) {
        this.noteUntrackedSessionDrop(dropId, currentMinutes, requiredMinutes);
      }
      this.currentDrop = this.resolveDisplayDrop(dropId, sessionDrop);
      if (!this.currentDrop || this.currentDrop.dropId !== dropId) {
        // We are not mining the drop Twitch reports for this channel; there is
        // nothing of ours to claim off the back of its counter.
        return true;
      }

      if (this.currentDrop.campaignId) {
        await this.ensureCampaignDrops(this.currentDrop.campaignId, dropId);
      }

      if (!this.currentDrop.imageUrl) {
        const found = findDropInCampaigns(this.allCampaigns, dropId);
        if (found) {
          this.currentDrop.imageUrl = found.drop.imageUrl || found.campaign.gameImageUrl;
        }
      }

      const found = findDropInCampaigns(this.allCampaigns, dropId);
      if (found && dropCanClaim(found.drop, found.campaign)) {
        void this.tryClaimDrop(dropId);
      }

      // Twitch often stops reporting progress at requiredMinutes-1 (e.g. 899/900).
      // The drop IS claimable but we won't know until an inventory refresh fetches canClaim.
      if (
        found &&
        !found.drop.isClaimed &&
        !found.drop.canClaim &&
        !found.drop.claimId &&
        requiredMinutes > 0 &&
        currentMinutes >= requiredMinutes - 1 &&
        currentMinutes < requiredMinutes &&
        !this.forceInventoryRefresh
      ) {
        this.forceInventoryRefresh = true;
      }

      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "sync failed";
      this.addLog("warn", `Drop progress sync failed: ${msg}`);
      return false;
    }
  }

  private watchingMatches(login: string): boolean {
    return Boolean(this.watching && sameLogin(this.watching.login, login));
  }

  private async performWatch() {
    // setInterval, channel refreshes, and a just-completed switch can all ask
    // for a watch tick at once. Serializing this prevents stale responses from
    // one tick from clearing/replacing the session selected by another.
    if (this.watchInFlight) return;
    this.watchInFlight = true;
    try {
      await this.performWatchInternal();
    } finally {
      this.watchInFlight = false;
    }
  }

  private async performWatchInternal() {
    if (!this.running) return;

    if (this.reward) {
      await this.rewardWatchTick();
      return;
    }

    if (this.miningCampaigns.length === 0) {
      if (this.watching) {
        this.clearWatchSession("No eligible campaigns — stopping watch");
      }
      this.enterIdleState(true);
      this.emit();
      return;
    }

    if (this.watching && !this.watchingAllowedByDropLists()) {
      this.clearWatchSession("Drop lists changed — switching to next campaign");
      await this.maintainWatching();
      return;
    }

    const login = this.watching?.login;
    if (!login || !this.broadcastId) {
      if (this.miningCampaigns.length > 0) {
        await this.maintainWatching();
      }
      return;
    }

    if (!this.watching!.id || !/^\d+$/.test(this.watching!.id)) {
      const info = await fetchStreamInfo(this.auth, login);
      if (!this.watchingMatches(login)) return;
      if (info.channelId) this.watching!.id = info.channelId;
      if (info.gameId) this.watching!.gameId = info.gameId;
      if (info.gameName) this.watching!.gameName = info.gameName;
      if (info.broadcastId) this.broadcastId = info.broadcastId;
      if (!info.channelId || !/^\d+$/.test(info.channelId)) {
        this.addLog("warn", `Cannot watch ${login}: missing channel ID`);
        return;
      }
    }

    const streamInfo = await fetchStreamInfo(this.auth, login);
    if (!this.watchingMatches(login)) return;

    if (streamInfo.online && streamInfo.broadcastId) {
      this.broadcastId = streamInfo.broadcastId;
      this.watching!.gameName = streamInfo.gameName;
      this.watching!.gameSlug = streamInfo.gameSlug;
      this.watching!.gameId = streamInfo.gameId;
    } else {
      this.addLog("warn", `${login} went offline during watch tick`);
      this.broadcastId = null;
      this.emit();
      return;
    }

    // Progress is measured on Twitch's own session counter, not on the drop we
    // display — the two are the same drop in the normal case, and when they are
    // not the session is still the only proof that watch time is being credited.
    const prevSessionDropId = this.watchSession?.dropId ?? null;
    const prevMinutes =
      this.watchSession?.currentMinutes ?? this.currentDrop?.currentMinutes ?? this.lastWatchMinutes ?? -1;

    try {
      if (!this.watchingMatches(login)) return;
      const stream = await sendWatchStream(this.auth, login);

      if (!this.watchingMatches(login)) return;

      if (!stream.ok) {
        this.consecutiveWatchFailures++;
        if (this.consecutiveWatchFailures === 1 || this.consecutiveWatchFailures % 2 === 0) {
          this.addLog("warn", `Stream watch failed for ${login}: ${stream.detail}`);
        }
        await this.syncDropProgress();
        if (!this.watchingMatches(login)) return;
        this.emit();
        return;
      }

      this.consecutiveWatchFailures = 0;
      const synced = await this.syncDropProgress();
      if (!this.watchingMatches(login)) return;

      // No drop session yet — try to infer from inventory, then keep watching
      if (!synced && !this.currentDrop) {
        const inferred = this.inferCurrentDropFromCampaigns();
        if (inferred) {
          this.currentDrop = inferred;
          this.emit();
          return;
        }
        const inGrace = Date.now() < this.watchGraceUntil;
        if (!inGrace) {
          this.consecutiveStallTicks++;
          // No drop session and nothing inferable — campaign may be fully claimed.
          // Trigger inventory refresh to get fresh claim status from Twitch.
          if (this.consecutiveStallTicks >= 3 && !this.forceInventoryRefresh) {
            this.forceInventoryRefresh = true;
            this.addLog("info", "No active drop session — refreshing inventory to check claim status");
            this.emit();
            return;
          }
          if (this.consecutiveStallTicks === 1 || this.consecutiveStallTicks % 5 === 0) {
            const focused = this.getFocusedCampaigns();
            const gameHint = focused.length > 0 && this.watching && !channelMatchesCampaigns(this.watching, focused)
              ? ` — channel streams ${this.watching.gameName || "unknown"}`
              : "";
            this.addLog(
              "warn",
              `No drop session from Twitch yet${gameHint}`
            );
          }
        }
        this.emit();
        return;
      }

      const newMinutes = this.watchSession?.currentMinutes ?? this.currentDrop?.currentMinutes ?? -1;
      const req = this.watchSession?.requiredMinutes || this.currentDrop?.requiredMinutes || 0;
      const progressDropId = this.watchSession?.dropId ?? this.currentDrop?.dropId ?? null;
      const progressDrop = progressDropId
        ? findDropInCampaigns(this.allCampaigns, progressDropId)
        : null;
      const sessionChanged = Boolean(
        prevSessionDropId && this.watchSession && this.watchSession.dropId !== prevSessionDropId
      );

      // Check if drop is complete (watch time reached or exceeded)
      if (req > 0 && newMinutes >= req && progressDropId) {
        if (progressDrop && !progressDrop.drop.isClaimed) {
          void this.onDropWatchComplete(progressDropId);
          this.emit();
          return;
        }
      }

      if (sessionChanged) {
        // Twitch moved us onto a different drop session; its counter restarts, so
        // the minute delta below would be meaningless.
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = newMinutes >= 0 ? newMinutes : null;
        this.consecutiveStallTicks = 0;
      } else if (newMinutes > prevMinutes) {
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = newMinutes;
        this.consecutiveStallTicks = 0;
        const label = progressDrop
          ? progressDrop.drop.name
          : this.watchSession
            ? "untracked campaign drop"
            : this.currentDrop?.dropName ?? "drop";
        this.addLog("success", `Watch minute credited: ${label} (${newMinutes}/${req})`);
      } else if (this.lastWatchAt === null) {
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = newMinutes >= 0 ? newMinutes : null;
      } else if (newMinutes === prevMinutes && prevMinutes >= 0) {
        // Don't try to claim early - wait for Twitch to send drop-claim websocket message
        // This prevents false positives and respects Twitch's official completion signal
        const inGrace = Date.now() < this.watchGraceUntil;
        if (inGrace) {
          this.emit();
          return;
        }
        this.consecutiveStallTicks++;
        if (this.consecutiveStallTicks === 1 || this.consecutiveStallTicks % 3 === 0) {
          const focused = this.getFocusedCampaigns();
          const gameHint =
            focused.length > 0 && this.watching && !channelMatchesCampaigns(this.watching, focused)
              ? ` — wrong game (streaming ${this.watching.gameName || "?"})`
              : this.watching?.dropsEnabled === false
                ? " — channel has no drops tag"
                : "";
          this.addLog(
            "warn",
            `No Twitch progress yet (${newMinutes}/${req || "?"} min) [${stream.detail}]${gameHint}`
          );
        }

        // After ~5 stall ticks (~15 min) without progress, try another channel.
        // If none found, go idle and wait for channel refresh to find one.
        if (this.consecutiveStallTicks >= 5) {
          const currentLogin = this.watching?.login;
          this.addLog("warn", `No drop progress on ${currentLogin ?? "channel"} — searching for another`);
          await this.refreshChannelsQuietly();
          const best = pickBestChannel(
            this.getDisplayChannels().filter((c) => !sameLogin(c.login, currentLogin)),
            this.getFocusedCampaigns(),
            null,
            null,
            this.settings.priorityGames
          );
          if (best) {
            this.consecutiveStallTicks = 0;
            await this.applyChannelSwitch(best.login);
            return;
          }
          this.consecutiveStallTicks = 0;
          this.clearWatchSession(`No channel with drops found — waiting for eligible channel`);
          this.forceInventoryRefresh = true;
        }
      }

      this.emit();
    } catch (err) {
      if (!this.watchingMatches(login)) return;
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        this.message = "Twitch session expired";
        this.state = "ERROR";
        this.addLog("error", "Twitch session expired — re-link required");
        this.emit();
        return;
      }
      const msg = err instanceof Error ? err.message : "watch failed";
      this.addLog("warn", `Watch failed: ${msg}`);
      await this.syncDropProgress();
      if (!this.watchingMatches(login)) return;
      this.emit();
    }
  }

  // ── Rewards: reward campaigns and creator badges ────────────────────────
  //
  // Queued rewards are mined only while the game miner has no channel to
  // watch. A pinned reward takes the watch slot from game drops until it is
  // earned, ends, or cannot be watched right now.

  /** Reward queue or pin changed from the UI. */
  async applyRewardQueue() {
    if (!this.running) return;
    const queue = this.settings.rewardQueue;
    rewardDirectory.track(queue.map((e) => e.channelId));

    if (this.reward) {
      const current = queue.find((e) => e.id === this.reward!.entry.id);
      if (!current) {
        this.stopReward(`Removed "${this.reward.entry.rewardName}" from the reward queue`);
      } else {
        this.reward.entry = current;
        this.reward.preempt = this.settings.pinnedRewardId === current.id;
      }
    }
    // A user change is a fresh start for everything still queued.
    for (const id of [...this.rewardCooldownUntil.keys()]) {
      if (!queue.some((e) => e.id === id)) this.rewardCooldownUntil.delete(id);
    }

    const channelIds = [...new Set(queue.filter((e) => e.kind === "channel").map((e) => e.channelId))];
    if (channelIds.length > 0) await rewardDirectory.refreshChannels(channelIds);
    await this.refreshQueuedRewardProgress(true);

    const pinned = queue.find((e) => e.id === this.settings.pinnedRewardId);
    if (pinned && this.reward?.entry.id !== pinned.id) {
      this.addLog("info", `Pinned "${pinned.rewardName}" — mining it before game drops`);
    }

    await this.maintainWatching();
    await this.maintainReward();
    this.emit();
  }

  private rewardViews(): RewardQueueView[] {
    const now = Date.now();
    return this.settings.rewardQueue.map((e) => {
      const p = this.rewardProgress.get(e.id);
      const mining = this.reward?.entry.id === e.id;
      const live =
        mining || (e.kind === "channel" ? rewardDirectory.isLive(e.channelId) === true : true);
      const cooldown = this.rewardCooldownUntil.get(e.id) ?? 0;
      let state: RewardQueueState;
      if (mining) state = "mining";
      else if (p?.status === "CLAIMABLE") state = "claimable";
      else if (cooldown > now) state = "paused";
      else state = live ? "waiting" : "offline";
      return {
        ...e,
        requiredMinutes: p?.requiredMinutes || e.requiredMinutes,
        currentMinutes: Math.max(0, p?.currentMinutes ?? 0),
        grantCount: p?.grantCount ?? 0,
        state,
        resumeAt: cooldown > now ? new Date(cooldown).toISOString() : null,
        live,
        pinned: this.settings.pinnedRewardId === e.id,
        watchingChannel: mining
          ? this.reward!.channelLogin
          : e.kind === "channel"
            ? e.channelLogin
            : null,
      };
    });
  }

  /** Earned for good: claimed, and no repeats left. */
  private rewardDone(e: RewardQueueEntry): boolean {
    const p = this.rewardProgress.get(e.id);
    if (!p) return false;
    if (e.repeatTimes) return p.grantCount >= e.repeatTimes;
    return p.status === "CLAIMED" || p.grantCount > 0;
  }

  private rewardEligible(e: RewardQueueEntry, now = Date.now()): boolean {
    if (e.endsAt && Date.parse(e.endsAt) <= now) return false;
    if ((this.rewardCooldownUntil.get(e.id) ?? 0) > now) return false;
    if (this.rewardDone(e)) return false;
    if (this.reward?.entry.id === e.id) return true;
    if (e.kind === "channel") return Boolean(e.channelLogin) && rewardDirectory.isLive(e.channelId) === true;
    return e.categoryIds.length > 0;
  }

  private pickRewardTarget(): { entry: RewardQueueEntry; preempt: boolean } | null {
    const queue = this.settings.rewardQueue;
    const pinned = queue.find((e) => e.id === this.settings.pinnedRewardId);
    if (pinned && this.rewardEligible(pinned)) return { entry: pinned, preempt: true };

    // Game drops come first; a queued reward only fills an idle watch slot.
    if (this.watching) return null;

    if (this.reward && this.reward.entry.id !== pinned?.id && this.rewardEligible(this.reward.entry)) {
      return { entry: this.reward.entry, preempt: false };
    }
    for (const e of queue) {
      if (e.id !== pinned?.id && this.rewardEligible(e)) return { entry: e, preempt: false };
    }
    return null;
  }

  private async maintainReward() {
    if (!this.running || this.rewardSwitching) return;
    this.pruneRewardQueue();
    // Try a few candidates per round so one unwatchable reward does not block the rest.
    for (let attempt = 0; attempt < 3; attempt++) {
      const target = this.pickRewardTarget();
      if (!target) {
        if (this.reward) this.stopReward();
        return;
      }
      if (this.reward?.entry.id === target.entry.id) {
        this.reward.preempt = target.preempt;
        return;
      }
      if (await this.startReward(target.entry, target.preempt)) return;
    }
  }

  private rewardCategoryOk(entry: RewardQueueEntry, gameId: string): boolean {
    return entry.categoryIds.length === 0 || entry.categoryIds.includes(gameId);
  }

  private coolDownReward(entry: RewardQueueEntry, ms: number) {
    this.rewardCooldownUntil.set(entry.id, Date.now() + ms);
  }

  /** Start watching for a reward. Returns false when it cannot be watched now. */
  private async startReward(entry: RewardQueueEntry, preempt: boolean): Promise<boolean> {
    this.rewardSwitching = true;
    try {
      let channelId = entry.channelId;
      let login = entry.channelLogin;
      if (entry.kind === "category") {
        const found = await findCategoryChannel(entry.categoryIds);
        if (!found) {
          this.coolDownReward(entry, 10 * 60 * 1000);
          this.addLog("info", `No live channel in ${entry.categoryNames.join(" / ")} for "${entry.rewardName}" — retrying in 10 min`);
          return false;
        }
        channelId = found.id;
        login = found.login;
      }

      const info = await fetchStreamInfo(this.auth, login);
      if (!this.running) return true;
      if (!info.online || !info.broadcastId) {
        if (entry.kind === "channel") rewardDirectory.setLive(entry.channelId, false);
        else this.coolDownReward(entry, 5 * 60 * 1000);
        return false;
      }
      if (!this.rewardCategoryOk(entry, info.gameId)) {
        this.coolDownReward(entry, entry.kind === "channel" ? REWARD_COOLDOWN_MS : 5 * 60 * 1000);
        this.addLog(
          "warn",
          `${login} streams "${info.gameName || "unknown"}" — "${entry.rewardName}" needs ${entry.categoryNames.join(" or ")}`
        );
        return false;
      }

      if (this.reward) this.stopReward();
      if (this.watching) {
        this.clearWatchSession(`Pinned "${entry.rewardName}" — pausing game drops`);
      }

      const progress = this.rewardProgress.get(entry.id);
      this.reward = {
        entry,
        preempt,
        channelId,
        channelLogin: login,
        broadcastId: info.broadcastId,
        gameName: info.gameName,
        lastMinutes: progress?.currentMinutes ?? -1,
        stallTicks: 0,
        watchFailures: 0,
      };
      this.lastWatchAt = new Date().toISOString();
      this.addLog(
        "success",
        `Now watching ${login} for "${entry.rewardName}" (${progress?.currentMinutes ?? 0}/${entry.requiredMinutes} min)${preempt ? " — pinned" : ""}`
      );
      this.emit();
      void this.performWatch();
      return true;
    } catch (err) {
      this.coolDownReward(entry, 5 * 60 * 1000);
      this.addLog("warn", `Reward switch failed: ${err instanceof Error ? err.message : "unknown error"}`);
      return false;
    } finally {
      this.rewardSwitching = false;
    }
  }

  private stopReward(message?: string) {
    if (!this.reward) return;
    if (message) this.addLog("info", message);
    this.reward = null;
    this.emit();
  }

  /** One minute of reward watching: keep the stream alive, then check progress. */
  private async rewardWatchTick() {
    const r = this.reward;
    if (!r) return;
    const { entry } = r;
    const login = r.channelLogin;

    try {
      const info = await fetchStreamInfo(this.auth, login);
      if (this.reward !== r) return;
      if (!info.online || !info.broadcastId) {
        if (entry.kind === "channel") rewardDirectory.setLive(entry.channelId, false);
        // Category rewards pick another channel on the next round.
        this.stopReward(`${login} went offline — pausing "${entry.rewardName}"`);
        return;
      }
      r.broadcastId = info.broadcastId;
      r.gameName = info.gameName;
      if (!this.rewardCategoryOk(entry, info.gameId)) {
        if (entry.kind === "channel") this.coolDownReward(entry, REWARD_COOLDOWN_MS);
        this.stopReward(
          `${login} switched to "${info.gameName || "unknown"}" — "${entry.rewardName}" needs ${entry.categoryNames.join(" or ")}`
        );
        return;
      }

      const stream = await sendWatchStream(this.auth, login);
      if (this.reward !== r) return;
      if (!stream.ok) {
        r.watchFailures++;
        if (r.watchFailures === 1 || r.watchFailures % 3 === 0) {
          this.addLog("warn", `Stream watch failed for ${login}: ${stream.detail}`);
        }
      } else {
        r.watchFailures = 0;
      }

      await this.fetchRewardProgressFor(entry);
      if (this.reward !== r) return;
      const p = this.rewardProgress.get(entry.id);

      if (p?.status === "CLAIMABLE") {
        await this.claimQueuedReward(entry);
        return;
      }
      if (this.settleReward(entry)) return;

      const minutes = p?.currentMinutes ?? -1;
      if (minutes > r.lastMinutes && r.lastMinutes >= 0) {
        this.addLog("success", `Reward minute credited: ${entry.rewardName} (${minutes}/${entry.requiredMinutes})`);
        r.stallTicks = 0;
        this.lastWatchAt = new Date().toISOString();
      } else if (r.lastMinutes < 0 && minutes >= 0) {
        this.lastWatchAt = new Date().toISOString();
      } else {
        r.stallTicks++;
        if (r.stallTicks === 5 || r.stallTicks === 10) {
          this.addLog(
            "warn",
            `No reward progress yet on ${login} (${Math.max(minutes, 0)}/${entry.requiredMinutes} min) [${stream.detail}]`
          );
        }
        if (r.stallTicks >= REWARD_STALL_TICKS) {
          this.coolDownReward(entry, REWARD_COOLDOWN_MS);
          this.stopReward(`No progress for "${entry.rewardName}" on ${login} for ~15 min — skipping it for 30 min`);
          return;
        }
      }
      if (minutes >= 0) r.lastMinutes = Math.max(r.lastMinutes, minutes);
      this.emit();
    } catch (err) {
      if (this.reward !== r) return;
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        this.stopReward();
        this.state = "ERROR";
        this.message = "Twitch session expired";
        this.addLog("error", "Twitch session expired — re-link required");
        this.emit();
        return;
      }
      this.addLog("warn", `Reward watch failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  /**
   * Handle a reward that cannot progress right now: earned for good → drop
   * it; repeatable and waiting for its next window → pause until then.
   * Returns true if the reward stopped being mined.
   */
  private settleReward(entry: RewardQueueEntry): boolean {
    if (this.rewardDone(entry)) {
      this.finishReward(entry, "already earned");
      return true;
    }
    const p = this.rewardProgress.get(entry.id);
    const next = p?.nextEligibleAt ? Date.parse(p.nextEligibleAt) : NaN;
    if (Number.isFinite(next) && next > Date.now() && p?.status !== "CLAIMABLE") {
      if ((this.rewardCooldownUntil.get(entry.id) ?? 0) < next) {
        this.rewardCooldownUntil.set(entry.id, next);
        this.addLog(
          "info",
          `"${entry.rewardName}" earned ${p?.grantCount ?? 0}${entry.repeatTimes ? `/${entry.repeatTimes}` : ""} — next one from ${new Date(next).toLocaleString()}`
        );
      }
      if (this.reward?.entry.id === entry.id) this.stopReward();
      return true;
    }
    return false;
  }

  /** Load progress for one queued reward (and others sharing its query). */
  private async fetchRewardProgressFor(entry: RewardQueueEntry): Promise<boolean> {
    try {
      const progress = await fetchRewardProgress(this.auth, entry);
      for (const e of this.settings.rewardQueue) {
        const same =
          e.kind === entry.kind &&
          (e.kind === "channel" ? e.channelId === entry.channelId : e.campaignId === entry.campaignId);
        if (!same) continue;
        const p = progress.get(e.rewardGroupId);
        if (p) this.rewardProgress.set(e.id, p);
      }
      return true;
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") throw err;
      const now = Date.now();
      if (now - this.rewardProgressErrorAt > 10 * 60 * 1000) {
        this.rewardProgressErrorAt = now;
        this.addLog(
          "warn",
          `Could not load reward progress: ${err instanceof Error ? err.message : "unknown error"}`
        );
      }
      return false;
    }
  }

  /** Periodic progress check for queued rewards; claims any that are ready. */
  private async refreshQueuedRewardProgress(force = false) {
    const queue = this.settings.rewardQueue;
    if (queue.length === 0) return;
    const now = Date.now();
    if (!force && now - this.lastRewardQueueRefresh < REWARD_QUEUE_REFRESH_MS) return;
    this.lastRewardQueueRefresh = now;

    const seen = new Set<string>();
    for (const e of queue) {
      const key = e.kind === "channel" ? `c:${e.channelId}` : `k:${e.campaignId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!force && this.reward?.entry.id === e.id) continue;
      try {
        await this.fetchRewardProgressFor(e);
      } catch {
        return;
      }
    }

    for (const e of [...this.settings.rewardQueue]) {
      if (this.rewardProgress.get(e.id)?.status === "CLAIMABLE") await this.claimQueuedReward(e);
      else this.settleReward(e);
    }
  }

  private async claimQueuedReward(entry: RewardQueueEntry) {
    const now = Date.now();
    if (now - (this.rewardClaimAttemptAt.get(entry.id) ?? 0) < REWARD_CLAIM_RETRY_MS) return;
    this.rewardClaimAttemptAt.set(entry.id, now);
    const label = entry.kind === "channel" ? entry.channelDisplayName || entry.channelLogin : entry.campaignName;
    try {
      this.addLog("info", `Claiming reward: ${entry.rewardName} (${label})`);
      const before = this.rewardProgress.get(entry.id)?.grantCount ?? 0;
      const status = await claimReward(this.auth, entry.campaignId, entry.rewardGroupId);
      await this.fetchRewardProgressFor(entry);
      const after = this.rewardProgress.get(entry.id);
      const claimed =
        status === "ELIGIBLE_FOR_ALL" ||
        status === "DROP_INSTANCE_ALREADY_CLAIMED" ||
        (after !== undefined && after.status !== "CLAIMABLE" && after.grantCount > before);
      if (!claimed) {
        this.addLog("warn", `Reward claim not confirmed (${status || "no status"}) — retrying in 5 min`);
        return;
      }
      this.addLog("success", `Claimed reward: ${entry.rewardName} (${label})`);
      this.rewardClaimAttemptAt.delete(entry.id);
      if (after && after.grantCount <= before) after.grantCount = before + 1;
      if (!entry.repeatTimes) {
        this.finishReward(entry);
        return;
      }
      if (!this.settleReward(entry) && this.reward?.entry.id === entry.id) {
        // Repeatable and the next round is open right away — keep watching.
        this.reward.lastMinutes = -1;
        this.reward.stallTicks = 0;
      }
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") throw err;
      this.addLog("warn", `Reward claim failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  /** Reward earned (or gone) — drop it from the queue and free the watch slot. */
  private finishReward(entry: RewardQueueEntry, note?: string) {
    const queue = this.settings.rewardQueue.filter((e) => e.id !== entry.id);
    const pinnedRewardId = this.settings.pinnedRewardId === entry.id ? null : this.settings.pinnedRewardId;
    this.settings.rewardQueue = queue;
    this.settings.pinnedRewardId = pinnedRewardId;
    this.onSettingsPersist({ rewardQueue: queue, pinnedRewardId });
    this.rewardProgress.delete(entry.id);
    this.rewardCooldownUntil.delete(entry.id);
    this.rewardClaimAttemptAt.delete(entry.id);
    if (note) this.addLog("info", `"${entry.rewardName}" ${note} — removed from queue`);
    if (this.reward?.entry.id === entry.id) this.stopReward();
    this.emit();
  }

  private pruneRewardQueue() {
    const now = Date.now();
    for (const e of [...this.settings.rewardQueue]) {
      if (e.endsAt && Date.parse(e.endsAt) <= now) this.finishReward(e, "ended");
    }
  }
}
