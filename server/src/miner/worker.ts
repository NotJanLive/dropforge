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
  ONLINE_DELAY_MS,
  MAX_CHANNELS,
  CHANNEL_REFRESH_MS,
  LOOP_INTERVAL_MS,
  INVENTORY_MAINTENANCE_MS,
  MAX_MINER_LOGS,
} from "./constants.js";
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
import { fetchStreamInfo, sendWatch, sendWatchStream, channelHasCampaignDrops } from "./channel.js";
import { GqlClient } from "./gql.js";
import { computeActiveMining, updateDropMinutesInCampaigns, extractImagesFromSession } from "./progress.js";

export interface MinerSettings {
  priorityMode: PriorityMode;
  priorityGames: string[];
  excludeGames: string[];
  manualChannelLogin: string | null;
  activeCampaignId: string | null;
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
  private watchGraceUntil = 0;
  private maintenanceTriggers: number[] = [];
  private claimedDropIds: Set<string>;

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
    await this.markChannelDropFlags();
    this.pruneChannelsWithoutDrops();
    this.ensureWatchingInChannelList();
    for (const ch of this.channels) this.subscribeChannel(ch);
  }

  private async markChannelDropFlags() {
    const focused = this.getFocusedCampaigns();
    if (focused.length === 0) return;

    const miningIds = new Set(focused.map((c) => c.id));
    const concurrency = 10;

    for (let i = 0; i < this.channels.length; i += concurrency) {
      const batch = this.channels.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (ch) => {
          if (!ch.online) {
            ch.dropsEnabled = false;
            return;
          }

          const fromDirectory =
            !ch.aclPreferred &&
            ch.campaignIds.some((id) => miningIds.has(id)) &&
            channelMatchesCampaigns(ch, focused);

          if (fromDirectory) {
            ch.dropsEnabled = true;
            return;
          }

          if (!ch.id || !/^\d+$/.test(ch.id)) {
            ch.dropsEnabled = false;
            return;
          }

          ch.dropsEnabled = await channelHasCampaignDrops(this.auth, ch.id, focused);
        })
      );
    }
  }

  /** Channels with drops enabled for the focused campaign (UI + mining). */
  private getDisplayChannels(): ChannelInfo[] {
    return this.channels.filter((c) => c.dropsEnabled === true);
  }

  private pruneChannelsWithoutDrops() {
    this.channels = this.channels.filter((c) => c.dropsEnabled === true);
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
    const focused = this.resolveFocusedCampaign();
    const activeMining = computeActiveMining(
      this.allCampaigns,
      this.currentDrop,
      this.watching?.gameName ?? null,
      this.lastWatchAt
    );
    return {
      state: this.state,
      message: this.message,
      watchingChannel: this.watching?.login ?? null,
      watchingGame: this.watching?.gameName ?? null,
      currentDrop: this.currentDrop,
      activeMining,
      campaigns: this.allCampaigns,
      channels: this.getDisplayChannels(),
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
    };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.addLog("info", "Miner started");
    this.setupPubSub();
    this.loopPromise = this.runLoop();
    this.startWatchLoop();
    void this.refreshInventory();
    this.emit();
  }

  async stop() {
    this.running = false;
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

  /** Scan all campaigns for drops marked isClaimed and persist any new ones. */
  private persistNewlyClaimedDrops() {
    let changed = false;
    for (const campaign of this.allCampaigns) {
      for (const drop of campaign.drops) {
        if (drop.isClaimed && !this.claimedDropIds.has(drop.id)) {
          this.claimedDropIds.add(drop.id);
          changed = true;
        }
      }
    }
    if (changed) {
      this.onClaimedDropsPersist(this.claimedDropIds);
    }
  }

  private applyPersistedClaimedStatus() {
    if (this.claimedDropIds.size === 0) return;
    for (const campaign of this.allCampaigns) {
      for (const drop of campaign.drops) {
        if (this.claimedDropIds.has(drop.id) && !drop.isClaimed) {
          drop.isClaimed = true;
          drop.isComplete = true;
          drop.canClaim = false;
          if (drop.requiredMinutes > 0) {
            drop.currentMinutes = drop.requiredMinutes;
          }
        }
      }
    }
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
      const prevMinutes = this.currentDrop?.currentMinutes ?? -1;
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
      if (progress) {
        this.currentDrop = progress;
      } else {
        const found = findDropInCampaigns(this.allCampaigns, parsed.dropId);
        this.currentDrop = {
          dropId: parsed.dropId,
          dropName: found?.drop.name ?? this.currentDrop?.dropName ?? parsed.dropId,
          campaignId: found?.campaign.id ?? this.currentDrop?.campaignId ?? "",
          campaignName: found?.campaign.name ?? this.currentDrop?.campaignName ?? "",
          gameName: found?.campaign.gameName ?? this.currentDrop?.gameName ?? this.watching?.gameName ?? "",
          imageUrl: found?.drop.imageUrl ?? found?.campaign.gameImageUrl ?? this.currentDrop?.imageUrl ?? "",
          gameImageUrl: found?.campaign.gameImageUrl ?? this.currentDrop?.gameImageUrl ?? "",
          currentMinutes: parsed.currentMinutes,
          requiredMinutes: parsed.requiredMinutes || found?.drop.requiredMinutes || this.currentDrop?.requiredMinutes || 0,
          isComplete: false,
        };
      }
      if (parsed.currentMinutes > prevMinutes) {
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = parsed.currentMinutes;
      }
      const required =
        parsed.requiredMinutes ||
        findDropInCampaigns(this.allCampaigns, parsed.dropId)?.drop.requiredMinutes ||
        this.currentDrop?.requiredMinutes ||
        0;
      if (required > 0 && parsed.currentMinutes >= required) {
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
      await this.afterDropClaimed(dropId, found.campaign);
      return;
    }
    await this.tryClaimDrop(dropId, dropInstanceId);
    const after = findDropInCampaigns(this.allCampaigns, dropId);
    if (after && !after.drop.isClaimed && dropCanClaim(after.drop, after.campaign)) {
      this.forceInventoryRefresh = true;
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

      const needGame = this.getFocusedCampaigns().map((c) => c.gameName).filter(Boolean);
      const gameOk = channelMatchesCampaigns(ch, this.getFocusedCampaigns());
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

      if (info.online && info.broadcastId) {
        this.broadcastId = info.broadcastId;
        this.setWatchingState(login);
        this.subscribeChannel(ch);

        const focused = this.getFocusedCampaigns();
        if (info.channelId && focused.length > 0) {
          const fromDirectory =
            !ch.aclPreferred &&
            ch.campaignIds.some((id) => focused.some((c) => c.id === id)) &&
            channelMatchesCampaigns(ch, focused);
          const hasDrops =
            fromDirectory ||
            (await channelHasCampaignDrops(this.auth, info.channelId, focused));
          ch.dropsEnabled = hasDrops;
          if (!hasDrops) {
            this.addLog(
              "warn",
              `${login} is live but drops are not enabled for this campaign — skipping`
            );
            this.watching = null;
            this.broadcastId = null;
            this.emit();
            return;
          }
        }

        await this.syncDropProgress();
        this.consecutiveStallTicks = 0;
        this.consecutiveWatchFailures = 0;
        this.watchGraceUntil = Date.now() + 65_000;
        if (this.currentDrop) {
          this.lastWatchMinutes = this.currentDrop.currentMinutes;
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

    if (
      (this.forceInventoryRefresh ||
        this.allCampaigns.length === 0 ||
        this.isInventoryMaintenanceDue(now)) &&
      !this.inventoryRefreshing
    ) {
      if (
        this.isInventoryMaintenanceDue(now) &&
        !this.forceInventoryRefresh &&
        this.allCampaigns.length > 0
      ) {
        this.addLog("info", "Scheduled inventory refresh (hourly check for new campaigns)");
        this.forceInventoryRefresh = true;
      }
      await this.refreshInventory();
    } else if (now - this.lastChannelRefresh >= CHANNEL_REFRESH_MS) {
      await this.refreshChannelsQuietly();
      this.lastChannelRefresh = now;
    }

    await this.claimWatchCompletedDrops();
    await this.maintainWatching();
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
    this.allCampaigns = finalizeCampaigns(merged);
    this.applyPersistedClaimedStatus();
    this.refilterMiningCampaigns();
    this.scheduleMaintenanceTriggers();
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
  }

  private resolveIdleMessage(): string {
    if (this.settings.priorityMode === "PRIORITY_ONLY" && this.settings.priorityGames.length === 0) {
      return "Idle — add games to your priority list to start mining";
    }
    const anyEarnable = this.allCampaigns.some((c) => c.linked && campaignHasEarnableDrops(c));
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
        !this.settings.priorityGames.some((g) => g.toLowerCase() === gameName)
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
      } else if (inList?.dropsEnabled === false) {
        this.addLog("warn", `${this.watching.login} has no drops — searching for another channel`);
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
    this.watchTimer = setInterval(() => this.performWatch(), WATCH_INTERVAL_MS);
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
            this.currentDrop = this.buildDropProgressFromSession(
              session,
              newDropId,
              currentMinutes,
              requiredMinutes
            );
            const found = findDropInCampaigns(this.allCampaigns, newDropId);
            this.addLog(
              "info",
              `Now mining: ${found?.drop.name ?? newDropId}${found ? ` (${found.campaign.gameName})` : ""}`
            );
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

      const campaignRaw = asRecord(session.campaign ?? session.dropCampaign);
      const campaignId = String(campaignRaw.id ?? session.campaignID ?? session.campaignId ?? "");
      if (campaignId) await this.ensureCampaignDrops(campaignId, dropId);

      // If Twitch is actively tracking this drop, it's NOT claimed yet — correct false positives
      const activeFound = findDropInCampaigns(this.allCampaigns, dropId);
      if (activeFound && activeFound.drop.isClaimed && currentMinutes < requiredMinutes) {
        activeFound.drop.isClaimed = false;
        activeFound.drop.isComplete = false;
        activeFound.drop.currentMinutes = currentMinutes;
        this.claimedDropIds.delete(dropId);
      }

      updateDropMinutesInCampaigns(this.allCampaigns, dropId, currentMinutes, requiredMinutes);
      this.persistNewlyClaimedDrops();
      this.currentDrop = this.buildDropProgressFromSession(session, dropId, currentMinutes, requiredMinutes);

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
    if (!this.running) return;

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

    const prevMinutes = this.currentDrop?.currentMinutes ?? this.lastWatchMinutes ?? -1;

    try {
      if (!this.watchingMatches(login)) return;
      const spade = await sendWatch(this.auth, this.watching!, this.broadcastId);
      void sendWatchStream(this.auth, login);

      if (!this.watchingMatches(login)) return;

      if (!spade.ok) {
        this.consecutiveWatchFailures++;
        const errDetail =
          spade.errors.length > 0 ? spade.errors.join("; ") : `HTTP status ${spade.status}`;
        if (this.consecutiveWatchFailures === 1 || this.consecutiveWatchFailures % 2 === 0) {
          this.addLog("warn", `Spade watch failed for ${login}: ${errDetail}`);
        }
        await this.syncDropProgress();
        if (!this.watchingMatches(login)) return;
        this.emit();
        return;
      }

      this.consecutiveWatchFailures = 0;
      const synced = await this.syncDropProgress();
      if (!this.watchingMatches(login)) return;

      // No drop session yet — keep watching, Twitch may need time to start tracking
      if (!synced && !this.currentDrop) {
        const inGrace = Date.now() < this.watchGraceUntil;
        if (!inGrace) {
          this.consecutiveStallTicks++;
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

      const newMinutes = this.currentDrop?.currentMinutes ?? -1;
      const req = this.currentDrop?.requiredMinutes ?? 0;

      // Check if drop is complete (watch time reached or exceeded)
      if (req > 0 && newMinutes >= req && this.currentDrop?.dropId) {
        const found = findDropInCampaigns(this.allCampaigns, this.currentDrop.dropId);
        if (found && !found.drop.isClaimed) {
          void this.onDropWatchComplete(this.currentDrop.dropId);
          this.emit();
          return;
        }
      }

      if (newMinutes > prevMinutes) {
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = newMinutes;
        this.consecutiveStallTicks = 0;
        this.addLog(
          "success",
          `Watch minute credited: ${this.currentDrop?.dropName ?? "drop"} (${newMinutes}/${req})`
        );
      } else if (this.lastWatchAt === null) {
        this.lastWatchAt = new Date().toISOString();
        this.lastWatchMinutes = newMinutes >= 0 ? newMinutes : null;
      } else if (newMinutes === prevMinutes && prevMinutes >= 0) {
        // Don't try to claim early - wait for Twitch to send drop-claim websocket message
        // This prevents false positives and respects Twitch's official completion signal
        const inGrace = Date.now() < this.watchGraceUntil;
        if (spade.ok && inGrace) {
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
            `No Twitch progress yet (${newMinutes}/${this.currentDrop?.requiredMinutes ?? "?"} min) [spade=${spade.status}]${gameHint}`
          );
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
}
