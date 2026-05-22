export interface InventoryCampaign {
  id: string;
  name: string;
  gameName: string;
  gameSlug?: string;
  gameImageUrl: string;
  status: string;
  linked: boolean;
  startsAt: string;
  endsAt: string;
  drops: Array<{
    id: string;
    name: string;
    imageUrl: string;
    requiredMinutes: number;
    currentMinutes: number;
    isComplete: boolean;
    isClaimed?: boolean;
    canClaim?: boolean;
  }>;
}

export interface InventoryFilterState {
  notLinked: boolean;
  upcoming: boolean;
  expired: boolean;
  excluded: boolean;
  finished: boolean;
}

export interface MinerFilterSettings {
  priorityMode: string;
  priorityGames: string[];
  excludeGames: string[];
}

export function defaultInventoryFilters(
  priorityMode: string,
  priorityGames: string[] = []
): InventoryFilterState {
  return {
    // TDM: with PRIORITY_ONLY, show unlinked campaigns only when that filter is on
    notLinked: priorityMode === "PRIORITY_ONLY",
    upcoming: true,
    expired: false,
    excluded: false,
    finished: false,
  };
}

function campaignRequiredMinutes(c: InventoryCampaign): number {
  return Math.max(...c.drops.map((d) => d.requiredMinutes), 0);
}

function isCampaignFinished(c: InventoryCampaign): boolean {
  return c.drops.every((d) => d.isClaimed || d.requiredMinutes <= 0);
}

function isCampaignActive(c: InventoryCampaign, now = Date.now()): boolean {
  if (c.status === "EXPIRED") return false;
  const start = Date.parse(c.startsAt);
  const end = Date.parse(c.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return c.status === "ACTIVE";
  return start <= now && now < end;
}

function isCampaignUpcoming(c: InventoryCampaign, now = Date.now()): boolean {
  if (c.status === "EXPIRED") return false;
  const start = Date.parse(c.startsAt);
  if (!Number.isFinite(start)) return false;
  return now < start;
}

function isCampaignExpired(c: InventoryCampaign, now = Date.now()): boolean {
  if (c.status === "EXPIRED") return true;
  const end = Date.parse(c.endsAt);
  if (!Number.isFinite(end)) return false;
  return end <= now;
}

export interface InventoryFilterOptions {
  /** Always show selected / actively mined campaigns */
  pinnedCampaignIds?: string[];
}

/** Match TwitchDropsMiner InventoryOverview._update_visibility */
export function campaignMatchesInventoryFilters(
  campaign: InventoryCampaign,
  filters: InventoryFilterState,
  settings: MinerFilterSettings,
  options: InventoryFilterOptions = {},
  now = Date.now()
): boolean {
  if (options.pinnedCampaignIds?.includes(campaign.id)) return true;

  if (campaignRequiredMinutes(campaign) <= 0) return false;

  const eligible = campaign.linked;
  if (!filters.notLinked && !eligible) return false;

  const active = isCampaignActive(campaign, now);
  const upcoming = isCampaignUpcoming(campaign, now);
  const expired = isCampaignExpired(campaign, now);
  if (!active && !(filters.upcoming && upcoming) && !(filters.expired && expired)) return false;

  const priorityOnly = settings.priorityMode === "PRIORITY_ONLY";
  const gameExcluded = settings.excludeGames.some(
    (g) => g.toLowerCase() === campaign.gameName.toLowerCase()
  );
  const gamePriority = settings.priorityGames.some(
    (g) => g.toLowerCase() === campaign.gameName.toLowerCase()
  );

  // TDM: excluded_filter OR ((game not in exclude) AND (NOT priority_only OR game in priority))
  // Miner only applies priority when the list is non-empty — match that here.
  const passesGameRules =
    filters.excluded ||
    ((!gameExcluded &&
      (!priorityOnly || settings.priorityGames.length === 0 || gamePriority)) as boolean);

  if (!passesGameRules) return false;

  const finished = isCampaignFinished(campaign);
  if (!filters.finished && finished) return false;

  return true;
}

/** Minimal fields for display sort order. */
export interface CampaignSortInput {
  id: string;
  name: string;
  gameName: string;
  status: string;
  linked: boolean;
  startsAt?: string;
  endsAt: string;
  drops?: InventoryCampaign["drops"];
}

function campaignHasWatchProgress(c: CampaignSortInput): boolean {
  if (!c.drops?.length) return false;
  return c.drops.some((d) => (d.currentMinutes > 0 && !d.isClaimed) || Boolean(d.canClaim));
}

function sortIsExpired(c: CampaignSortInput, now: number): boolean {
  if (c.status === "EXPIRED") return true;
  const end = Date.parse(c.endsAt);
  if (Number.isFinite(end) && end <= now) return true;
  return false;
}

function sortIsUpcoming(c: CampaignSortInput, now: number): boolean {
  if (sortIsExpired(c, now)) return false;
  const start = c.startsAt ? Date.parse(c.startsAt) : Number.NaN;
  if (Number.isFinite(start)) return now < start;
  return c.status === "UPCOMING";
}

function sortIsActive(c: CampaignSortInput, now: number): boolean {
  if (sortIsExpired(c, now) || sortIsUpcoming(c, now)) return false;
  const start = c.startsAt ? Date.parse(c.startsAt) : Number.NaN;
  const end = Date.parse(c.endsAt);
  if (Number.isFinite(start) && Number.isFinite(end)) return start <= now && now < end;
  if (Number.isFinite(end)) return now < end;
  return c.status === "ACTIVE";
}

/** Rank within the middle bucket (not mining, not active+linked, not expired). */
function otherCampaignRank(c: CampaignSortInput, now: number): number {
  if (sortIsActive(c, now) && !c.linked) return 0;
  if (sortIsUpcoming(c, now) && c.linked) return 1;
  if (sortIsUpcoming(c, now)) return 2;
  return 3;
}

/**
 * 1. Actively mined campaign (top)
 * 2. Active & linked (not expired)
 * 3. Other (active unlinked → upcoming)
 * 4. Expired (always last)
 */
export function sortCampaignsByPriority<T extends CampaignSortInput>(
  campaigns: T[],
  options: { miningCampaignId?: string | null } = {},
  now = Date.now()
): T[] {
  const miningId = options.miningCampaignId ?? null;

  const tier = (c: T): number => {
    if (miningId && c.id === miningId) return 0;
    if (sortIsExpired(c, now)) return 3;
    if (sortIsActive(c, now) && c.linked) return 1;
    return 2;
  };

  return [...campaigns].sort((a, b) => {
    const ta = tier(a);
    const tb = tier(b);
    if (ta !== tb) return ta - tb;

    if (ta === 1) {
      const pa = campaignHasWatchProgress(a) ? 0 : 1;
      const pb = campaignHasWatchProgress(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
    }

    if (ta === 2) {
      const ra = otherCampaignRank(a, now);
      const rb = otherCampaignRank(b, now);
      if (ra !== rb) return ra - rb;
    }

    if (ta === 3) {
      const endA = Date.parse(a.endsAt) || 0;
      const endB = Date.parse(b.endsAt) || 0;
      if (endA !== endB) return endB - endA;
    } else {
      const endA = Date.parse(a.endsAt) || Number.MAX_SAFE_INTEGER;
      const endB = Date.parse(b.endsAt) || Number.MAX_SAFE_INTEGER;
      if (endA !== endB) return endA - endB;
    }

    return a.gameName.localeCompare(b.gameName) || a.name.localeCompare(b.name);
  });
}

export type DropInventoryStatus = "claimed" | "ready" | "progress" | "pending";

export function dropInventoryStatus(
  drop: InventoryCampaign["drops"][number]
): DropInventoryStatus {
  if (drop.isClaimed) return "claimed";
  if (drop.canClaim) return "ready";
  if (drop.currentMinutes > 0 || drop.isComplete) return "progress";
  return "pending";
}
