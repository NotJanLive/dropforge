import type { ActiveMiningView, CampaignDropView, CampaignInfo, DropProgress } from "./constants.js";
import { mergeGameRecords, resolveGameImageUrl } from "./gameImage.js";

export type { ActiveMiningView };

export interface CampaignMetrics {
  progress: number;
  /** Drops actually claimed on Twitch (TDM claimed_drops). */
  claimedDrops: number;
  total: number;
  remainingMinutes: number;
}

function tdmRemainingSeconds(
  remainingMinutes: number,
  lastWatchAt: string | null | undefined,
  nowMs = Date.now()
): number {
  if (remainingMinutes <= 0) return 0;
  if (!lastWatchAt) return remainingMinutes * 60;

  const elapsed = Math.max(0, Math.floor((nowMs - new Date(lastWatchAt).getTime()) / 1000));
  const secInMinute = elapsed % 60;

  if (secInMinute === 0 && elapsed === 0) return remainingMinutes * 60;

  const displayMinutes = secInMinute > 0 ? Math.max(0, remainingMinutes - 1) : remainingMinutes;
  const displaySeconds = secInMinute > 0 ? 60 - secInMinute : 0;
  return displayMinutes * 60 + displaySeconds;
}

/** Seconds left to watch (TDM ProgressBar display). */
export function watchRemainingSeconds(
  currentMinutes: number,
  requiredMinutes: number,
  lastWatchAt: string | null | undefined,
  nowMs = Date.now()
): number {
  if (requiredMinutes <= 0 || currentMinutes >= requiredMinutes) return 0;
  return tdmRemainingSeconds(requiredMinutes - currentMinutes, lastWatchAt, nowMs);
}

export function watchRemainingSecondsFromMinutes(
  remainingMinutes: number,
  lastWatchAt: string | null | undefined,
  nowMs = Date.now()
): number {
  return tdmRemainingSeconds(remainingMinutes, lastWatchAt, nowMs);
}

/** Total watch minutes left across all drops (e.g. 293/360 cumulative → 67 min). */
export function campaignRemainingMinutesTotal(
  campaign: CampaignInfo,
  activeDropId?: string
): number {
  const drops = campaign.drops;
  if (drops.length === 0) return 0;

  const hasPreconditions = drops.some((d) => (d.preconditionDropIds?.length ?? 0) > 0);
  if (hasPreconditions) {
    let maxRemaining = 0;
    for (const d of drops) {
      if (!d.isClaimed) {
        maxRemaining = Math.max(maxRemaining, dropTotalRemainingMinutes(campaign, d.id));
      }
    }
    return maxRemaining;
  }

  if (isCumulativeDropChain(drops)) {
    const unclaimedTimed = drops.filter((d) => !d.isClaimed && d.requiredMinutes > 0);
    if (unclaimedTimed.length === 0) return 0;
    const target = Math.max(...unclaimedTimed.map((d) => d.requiredMinutes));
    const watched = watchedCumulativeMinutes(campaign, activeDropId);
    return Math.max(0, target - watched);
  }

  return Math.max(
    0,
    drops.reduce((sum, d) => {
      const req = Math.max(0, d.requiredMinutes);
      if (req <= 0 || d.isClaimed) return sum;
      return sum + Math.max(0, req - Math.min(d.currentMinutes, req));
    }, 0)
  );
}

function isCumulativeDropChain(drops: CampaignInfo["drops"]): boolean {
  const timed = drops.filter((d) => d.requiredMinutes > 0);
  if (timed.length <= 1) return true;
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].requiredMinutes <= timed[i - 1].requiredMinutes) return false;
  }
  return true;
}

/** Cumulative watch position in sequential campaigns (Twitch reports this on the active drop). */
function watchedCumulativeMinutes(campaign: CampaignInfo, activeDropId?: string): number {
  if (activeDropId) {
    const active = campaign.drops.find((d) => d.id === activeDropId);
    if (active && active.requiredMinutes > 0) {
      return active.isClaimed ? active.requiredMinutes : active.currentMinutes;
    }
  }

  let watched = 0;
  for (const d of campaign.drops) {
    if (d.requiredMinutes <= 0) continue;
    if (d.isClaimed) watched = Math.max(watched, d.requiredMinutes);
    else if (d.currentMinutes > 0) watched = Math.max(watched, d.currentMinutes);
  }
  return watched;
}

function dropOwnRemainingMinutes(drop: CampaignInfo["drops"][number]): number {
  if (drop.isClaimed) return 0;
  if (drop.requiredMinutes <= 0) return 0;
  return Math.max(0, drop.requiredMinutes - drop.currentMinutes);
}

function dropTotalRemainingMinutes(
  campaign: CampaignInfo,
  dropId: string,
  cache = new Map<string, number>()
): number {
  const cached = cache.get(dropId);
  if (cached !== undefined) return cached;

  const drop = campaign.drops.find((d) => d.id === dropId);
  if (!drop || drop.isClaimed) {
    cache.set(dropId, 0);
    return 0;
  }

  const own = dropOwnRemainingMinutes(drop);
  const preMax = Math.max(
    0,
    ...(drop.preconditionDropIds ?? []).map((pid) => dropTotalRemainingMinutes(campaign, pid, cache))
  );
  const total = own + preMax;
  cache.set(dropId, total);
  return total;
}

/** Mark earlier sequential drops complete when a later drop has watch progress. */
export function applySequentialDropProgress(
  campaign: CampaignInfo,
  activeDropId: string,
  currentMinutes: number,
  requiredMinutes?: number
): number {
  const idx = campaign.drops.findIndex((d) => d.id === activeDropId);
  if (idx < 0) return -1;

  for (let i = 0; i < idx; i++) {
    const d = campaign.drops[i];
    if (d.requiredMinutes > 0) {
      d.currentMinutes = d.requiredMinutes;
      d.isComplete = true;
    }
  }

  const active = campaign.drops[idx];
  active.currentMinutes = Math.max(active.currentMinutes, currentMinutes);
  if (requiredMinutes && requiredMinutes > 0) {
    active.requiredMinutes = requiredMinutes;
  }
  if (active.requiredMinutes > 0 && active.currentMinutes >= active.requiredMinutes) {
    active.isComplete = true;
  }

  return idx;
}

export function computeCampaignMetrics(
  campaign: CampaignInfo,
  activeDropId?: string
): CampaignMetrics {
  const total = campaign.drops.length;

  const claimedDrops = campaign.drops.filter((d) => d.isClaimed).length;

  const progress =
    total > 0
      ? (campaign.drops.reduce((sum, d) => {
          if (d.requiredMinutes <= 0) return sum + (d.isClaimed ? 1 : 0);
          const mins = d.isClaimed ? d.requiredMinutes : d.currentMinutes;
          return sum + Math.min(1, mins / d.requiredMinutes);
        }, 0) /
          total) *
        100
      : 0;

  const remainingMinutes = campaignRemainingMinutesTotal(campaign, activeDropId);

  return { progress, claimedDrops, total, remainingMinutes };
}

export function findCampaignForDrop(
  campaigns: CampaignInfo[],
  dropId: string,
  campaignId?: string,
  gameName?: string | null
): CampaignInfo | null {
  if (campaignId) {
    const byId = campaigns.find((c) => c.id === campaignId);
    if (byId) return byId;
  }
  if (dropId) {
    const byDrop = campaigns.find((c) => c.drops.some((d) => d.id === dropId));
    if (byDrop) return byDrop;
  }
  if (gameName) {
    const g = gameName.toLowerCase();
    const byGame = campaigns.find(
      (c) => c.gameName.toLowerCase() === g && (c.status === "ACTIVE" || c.drops.some((d) => !d.isComplete))
    );
    if (byGame) return byGame;
  }
  return null;
}

export function splitCampaignDrops(
  campaign: CampaignInfo,
  activeDropId: string
): { claimed: CampaignDropView[]; upcoming: CampaignDropView[] } {
  const gameImageUrl = campaign.gameImageUrl ?? "";
  const toDropView = (d: CampaignInfo["drops"][number]): CampaignDropView => ({
    id: d.id,
    name: d.name,
    imageUrl: d.imageUrl || gameImageUrl,
    requiredMinutes: d.requiredMinutes,
    currentMinutes: d.isClaimed && d.requiredMinutes > 0 ? d.requiredMinutes : d.currentMinutes,
    isComplete: d.isComplete,
    isClaimed: d.isClaimed,
  });

  const activeIdx = campaign.drops.findIndex((d) => d.id === activeDropId);
  if (activeIdx < 0) {
    return {
      claimed: campaign.drops.filter((d) => d.isClaimed).map(toDropView),
      upcoming: campaign.drops.filter((d) => !d.isClaimed && d.id !== activeDropId).map(toDropView),
    };
  }

  return {
    claimed: campaign.drops.filter((d, i) => i < activeIdx && (d.isClaimed || d.isComplete)).map(toDropView),
    upcoming: campaign.drops.slice(activeIdx + 1).map(toDropView),
  };
}

export function computeActiveMining(
  campaigns: CampaignInfo[],
  currentDrop: DropProgress | null,
  watchingGame: string | null,
  lastWatchAt: string | null | undefined
): ActiveMiningView | null {
  if (!currentDrop?.dropId) return null;

  let campaign: CampaignInfo | null = null;
  if (currentDrop.campaignId) {
    campaign = campaigns.find((c) => c.id === currentDrop.campaignId) ?? null;
  }
  if (!campaign) {
    campaign = findCampaignForDrop(
      campaigns,
      currentDrop.dropId,
      currentDrop.campaignId || undefined,
      currentDrop.gameName || watchingGame
    );
  }

  if (campaign) {
    applySequentialDropProgress(
      campaign,
      currentDrop.dropId,
      currentDrop.currentMinutes,
      currentDrop.requiredMinutes
    );
  }

  const dropInCampaign = campaign?.drops.find((d) => d.id === currentDrop.dropId);
  const dropCurrent =
    dropInCampaign?.isClaimed && dropInCampaign.requiredMinutes > 0
      ? dropInCampaign.requiredMinutes
      : (dropInCampaign?.currentMinutes ?? currentDrop.currentMinutes);
  const dropRequired = dropInCampaign?.requiredMinutes || currentDrop.requiredMinutes;
  const dropRemainingMinutes =
    dropInCampaign?.isClaimed ? 0 : dropRequired > 0 ? Math.max(0, dropRequired - dropCurrent) : 0;
  const dropProgress = dropRequired > 0 ? Math.min(100, (dropCurrent / dropRequired) * 100) : 0;
  const dropRemainingSeconds = watchRemainingSeconds(dropCurrent, dropRequired, lastWatchAt);

  const campaignMetrics = campaign
    ? computeCampaignMetrics(campaign, currentDrop.dropId)
    : null;

  const campaignRemainingSeconds = watchRemainingSecondsFromMinutes(
    campaignMetrics?.remainingMinutes ?? dropRemainingMinutes,
    lastWatchAt
  );

  const gameImageUrl =
    campaign?.gameImageUrl ||
    currentDrop.gameImageUrl ||
    dropInCampaign?.imageUrl ||
    currentDrop.imageUrl ||
    "";

  const dropImageUrl =
    dropInCampaign?.imageUrl || currentDrop.imageUrl || gameImageUrl;

  const { claimed: claimedDrops, upcoming: upcomingDrops } = campaign
    ? splitCampaignDrops(campaign, currentDrop.dropId)
    : { claimed: [], upcoming: [] };

  return {
    gameName: campaign?.gameName ?? currentDrop.gameName,
    gameImageUrl,
    campaignId: campaign?.id ?? currentDrop.campaignId,
    campaignName: campaign?.name ?? currentDrop.campaignName,
    campaignProgress: campaignMetrics?.progress ?? 0,
    campaignClaimed: campaignMetrics?.claimedDrops ?? 0,
    campaignTotal: campaignMetrics?.total ?? 0,
    campaignRemainingMinutes: campaignMetrics?.remainingMinutes ?? dropRemainingMinutes,
    dropId: currentDrop.dropId,
    dropName: dropInCampaign?.name ?? currentDrop.dropName,
    dropImageUrl,
    dropProgress,
    dropCurrentMinutes: dropCurrent,
    dropRequiredMinutes: dropRequired,
    dropRemainingMinutes,
    dropRemainingSeconds,
    campaignRemainingSeconds,
    claimedDrops,
    upcomingDrops,
  };
}

export function updateDropMinutesInCampaigns(
  campaigns: CampaignInfo[],
  dropId: string,
  currentMinutes: number,
  requiredMinutes?: number
): CampaignInfo | null {
  for (const campaign of campaigns) {
    const idx = applySequentialDropProgress(campaign, dropId, currentMinutes, requiredMinutes);
    if (idx >= 0) return campaign;
  }
  return null;
}

export function extractImagesFromSession(session: Record<string, unknown>): {
  dropImageUrl: string;
  gameImageUrl: string;
} {
  const drop = asRecord(session.drop);
  const campaign = asRecord(session.campaign ?? session.dropCampaign);
  const game = mergeGameRecords(session.game ?? null, campaign.game ?? null);
  const gameName = String(game.displayName ?? game.name ?? "");

  return {
    dropImageUrl: dropImageFrom(drop),
    gameImageUrl: resolveGameImageUrl({
      game,
      gameName,
      gameSlug: String(game.slug ?? ""),
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function dropImageFrom(d: Record<string, unknown>): string {
  const edges = asArray<Record<string, unknown>>(d.benefitEdges);
  for (const edge of edges) {
    const benefit = asRecord(edge.benefit);
    const url = String(benefit.imageAssetURL ?? benefit.imageAssetUrl ?? "");
    if (url) return url;
  }
  return String(d.imageURL ?? d.imageUrl ?? "");
}
