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

type CampaignDrop = CampaignInfo["drops"][number];

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

/** Milestone campaigns (Overwatch etc.) share one watch counter across drops. */
export function usesSharedWatchProgress(drops: CampaignDrop[]): boolean {
  if (drops.some((d) => (d.preconditionDropIds?.length ?? 0) > 0)) return false;

  const timed = drops.filter((d) => d.requiredMinutes > 0);
  if (timed.length <= 1) return true;

  const activeCount = timed.filter((d) => d.currentMinutes > 0 && !d.isClaimed).length;
  if (activeCount > 1) return false;

  const thresholds = timed.map((d) => d.requiredMinutes).sort((a, b) => a - b);
  return thresholds[thresholds.length - 1] > thresholds[0];
}

/** Cumulative watch position in milestone campaigns. */
export function watchedCumulativeMinutes(campaign: CampaignInfo, activeDropId?: string): number {
  const drops = campaign.drops;
  if (activeDropId) {
    const active = drops.find((d) => d.id === activeDropId);
    if (active && active.requiredMinutes > 0) {
      return active.isClaimed ? active.requiredMinutes : active.currentMinutes;
    }
  }

  let watched = 0;
  for (const d of drops) {
    if (d.requiredMinutes <= 0) continue;
    if (d.isClaimed) watched = Math.max(watched, d.requiredMinutes);
    else if (d.currentMinutes > 0) watched = Math.max(watched, d.currentMinutes);
  }
  return watched;
}

function dropOwnRemainingMinutes(drop: CampaignDrop): number {
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

/** Drop reached its watch milestone or was claimed (TDM inventory status). */
export function isDropEarned(
  drop: CampaignDrop,
  campaign: CampaignInfo,
  activeDropId?: string
): boolean {
  if (drop.isClaimed || drop.isComplete) return true;

  if (usesSharedWatchProgress(campaign.drops)) {
    const watched = watchedCumulativeMinutes(campaign, activeDropId);
    if (drop.requiredMinutes > 0 && watched >= drop.requiredMinutes) return true;
  }

  return false;
}

/** Total watch minutes left for the campaign (TDM campaign.remaining_minutes). */
export function campaignRemainingMinutesTotal(
  campaign: CampaignInfo,
  activeDropId?: string
): number {
  const drops = campaign.drops;
  if (drops.length === 0) return 0;

  const unclaimed = drops.filter((d) => !d.isClaimed && d.requiredMinutes > 0);
  if (unclaimed.length === 0) return 0;

  const hasPreconditions = drops.some((d) => (d.preconditionDropIds?.length ?? 0) > 0);
  if (hasPreconditions) {
    let maxRemaining = 0;
    for (const d of unclaimed) {
      maxRemaining = Math.max(maxRemaining, dropTotalRemainingMinutes(campaign, d.id));
    }
    return maxRemaining;
  }

  if (usesSharedWatchProgress(drops)) {
    const target = Math.max(...unclaimed.map((d) => d.requiredMinutes));
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

/** Mark earlier sequential drops complete when a later drop has watch progress. */
export function applySequentialDropProgress(
  campaign: CampaignInfo,
  activeDropId: string,
  currentMinutes: number,
  requiredMinutes?: number
): number {
  const idx = campaign.drops.findIndex((d) => d.id === activeDropId);
  if (idx < 0) return -1;

  if (usesSharedWatchProgress(campaign.drops)) {
    const active = campaign.drops[idx];
    active.currentMinutes = Math.max(active.currentMinutes, currentMinutes);
    if (requiredMinutes && requiredMinutes > 0) {
      active.requiredMinutes = requiredMinutes;
    }
    for (const d of campaign.drops) {
      if (d.requiredMinutes > 0 && active.currentMinutes >= d.requiredMinutes) {
        if (d.id === activeDropId) continue;
        // If Twitch is tracking a later drop, earlier ones must be claimed
        d.isClaimed = true;
        d.isComplete = true;
        d.currentMinutes = d.requiredMinutes;
      }
    }
    // Mark as complete when we reach the required minutes
    if (active.requiredMinutes > 0 && active.currentMinutes >= active.requiredMinutes) {
      active.isComplete = true;
    }
    return idx;
  }

  // Sequential drops: if Twitch is tracking drop at idx, all earlier drops are claimed
  for (let i = 0; i < idx; i++) {
    const d = campaign.drops[i];
    if (d.requiredMinutes > 0) {
      d.isClaimed = true;
      d.isComplete = true;
      d.currentMinutes = d.requiredMinutes;
    }
  }

  const active = campaign.drops[idx];
  active.currentMinutes = Math.max(active.currentMinutes, currentMinutes);
  if (requiredMinutes && requiredMinutes > 0) {
    active.requiredMinutes = requiredMinutes;
  }
  // Mark as complete when we reach the required minutes
  // Note: canClaim should only be set when Twitch sends drop-claim message with dropInstanceId
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
          if (d.requiredMinutes <= 0) return sum + (d.isClaimed || isDropEarned(d, campaign, activeDropId) ? 1 : 0);
          if (d.isClaimed || isDropEarned(d, campaign, activeDropId)) return sum + 1;
          const mins = d.currentMinutes;
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

function sortDropsByRequiredMinutes(drops: CampaignDropView[]): CampaignDropView[] {
  return [...drops].sort(
    (a, b) => a.requiredMinutes - b.requiredMinutes || a.name.localeCompare(b.name)
  );
}

export function splitCampaignDrops(
  campaign: CampaignInfo,
  activeDropId: string
): { claimed: CampaignDropView[]; upcoming: CampaignDropView[] } {
  const gameImageUrl = campaign.gameImageUrl ?? "";
  const toDropView = (d: CampaignDrop): CampaignDropView => ({
    id: d.id,
    name: d.name,
    imageUrl: d.imageUrl || gameImageUrl,
    requiredMinutes: d.requiredMinutes,
    currentMinutes: d.isClaimed && d.requiredMinutes > 0 ? d.requiredMinutes : d.currentMinutes,
    isComplete: d.isComplete || isDropEarned(d, campaign, activeDropId),
    isClaimed: d.isClaimed,
  });

  const claimed = campaign.drops
    .filter((d) => d.id !== activeDropId && (d.isClaimed || isDropEarned(d, campaign, activeDropId)))
    .map(toDropView);

  const upcoming = campaign.drops
    .filter(
      (d) =>
        d.id !== activeDropId &&
        !d.isClaimed &&
        !isDropEarned(d, campaign, activeDropId)
    )
    .map(toDropView);

  return {
    claimed: sortDropsByRequiredMinutes(claimed),
    upcoming: sortDropsByRequiredMinutes(upcoming),
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
