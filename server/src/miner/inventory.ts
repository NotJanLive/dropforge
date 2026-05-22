import type { TwitchAuthSession } from "../twitch/auth.js";
import { GqlClient } from "./gql.js";
import type { CampaignInfo, CampaignSummary, ChannelInfo, DropProgress, PriorityMode } from "./constants.js";
import { CAMPAIGN_DETAILS_CHUNK_SIZE } from "./constants.js";
import { enrichCampaignGameImages, enrichGameImages, mergeGameRecords, resolveGameImageUrl } from "./gameImage.js";
import { fetchStreamInfo } from "./channel.js";

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function gameImageFrom(raw: Record<string, unknown>, gameName = "", gameSlug = ""): string {
  return resolveGameImageUrl({
    game: mergeGameRecords(raw.game ?? null, null),
    gameName: gameName || String(asRecord(raw.game).displayName ?? asRecord(raw.game).name ?? ""),
    gameSlug,
  });
}

function dropImageFrom(d: Record<string, unknown>): string {
  const edges = asArray<Record<string, unknown>>(d.benefitEdges);
  for (const edge of edges) {
    const benefit = asRecord(edge.benefit);
    const url = String(benefit.imageAssetURL ?? benefit.imageAssetUrl ?? "");
    if (url) return url;
  }
  const img = String(d.imageURL ?? d.imageUrl ?? "");
  return img;
}

function parseCampaignSummary(raw: Record<string, unknown>): CampaignSummary {
  const game = asRecord(raw.game);
  const self = asRecord(raw.self);
  const drops = asArray(raw.timeBasedDrops);
  const gameName = String(game.displayName ?? game.name ?? "");
  const gameSlug = String(game.slug ?? "");
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    gameName,
    gameSlug,
    gameImageUrl: gameImageFrom(raw, gameName, gameSlug),
    status: String(raw.status ?? "ACTIVE"),
    linked: Boolean(self.isAccountConnected ?? true),
    startsAt: String(raw.startAt ?? ""),
    endsAt: String(raw.endAt ?? ""),
    dropCount: drops.length,
  };
}

function parseClaimedBenefits(inventory: Record<string, unknown>): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of asArray<Record<string, unknown>>(inventory.gameEventDrops)) {
    const id = String(raw.id ?? "");
    const at = String(raw.lastAwardedAt ?? "");
    if (id && at) map.set(id, Date.parse(at));
  }
  return map;
}

/** TDM: infer isClaimed from gameEventDrops when self edge is missing. */
function dropClaimedFromBenefits(
  drop: Record<string, unknown>,
  claimedBenefits: Map<string, number>
): boolean {
  const startsAt = Date.parse(String(drop.startAt ?? ""));
  const endsAt = Date.parse(String(drop.endAt ?? ""));
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return false;

  const edges = asArray<Record<string, unknown>>(drop.benefitEdges);
  if (edges.length === 0) return false;

  const awarded: number[] = [];
  for (const edge of edges) {
    const benefit = asRecord(edge.benefit);
    const bid = String(benefit.id ?? "");
    const ts = bid ? claimedBenefits.get(bid) : undefined;
    if (ts === undefined) return false;
    awarded.push(ts);
  }

  return awarded.every((ts) => ts >= startsAt && ts < endsAt);
}

function parseCampaignFromDetail(
  id: string,
  campaign: Record<string, unknown>,
  fallback?: Record<string, unknown>,
  claimedBenefits: Map<string, number> = new Map()
): CampaignInfo {
  const game = asRecord(campaign.game ?? fallback?.game);
  const allowed = asRecord(campaign.allow);
  const allowedChannels = asArray<Record<string, unknown>>(allowed.channels);

  const drops = asArray<Record<string, unknown>>(
    campaign.timeBasedDrops ?? fallback?.timeBasedDrops
  )
    .map((d) => {
    const self = asRecord(d.self);
    const required = Number(d.requiredMinutesWatched ?? 0);
    const current = Number(self.currentMinutesWatched ?? 0);
    const isClaimed =
      Boolean(self.isClaimed) || dropClaimedFromBenefits(d, claimedBenefits);
    return {
      id: String(d.id ?? ""),
      name: String(d.name ?? ""),
      imageUrl: dropImageFrom(d),
      requiredMinutes: required,
      currentMinutes: isClaimed && required > 0 ? required : current,
      isClaimed,
      isComplete: isClaimed || (required > 0 && current >= required),
      canClaim: Boolean(self.claimAvailable),
      claimId: self.dropInstanceID ? String(self.dropInstanceID) : undefined,
      preconditionDropIds: asArray<Record<string, unknown>>(d.preconditionDrops).map((p) =>
        String(asRecord(p).id ?? p)
      ),
      endsAt: String(d.endAt ?? ""),
      startAt: String(d.startAt ?? ""),
    };
  })
    .sort((a, b) => {
      if (a.startAt && b.startAt) return a.startAt.localeCompare(b.startAt);
      return 0;
    })
    .map(({ startAt: _s, ...drop }) => drop);

  const channels: ChannelInfo[] = allowedChannels.flatMap((entry) => {
    const ch = asRecord(entry);
    if (!ch.id) return [];
    return [{
      id: String(ch.id),
      login: String(ch.name ?? ch.login ?? ""),
      displayName: String(ch.displayName ?? ch.name ?? ""),
      gameName: "",
      gameSlug: "",
      online: false,
      viewers: 0,
      campaignIds: [id],
      aclPreferred: Boolean(allowed.isEnabled ?? true),
    }];
  });

  const base = fallback ?? campaign;
  const mergedGame = mergeGameRecords(campaign.game ?? null, base.game ?? null);
  const gameName = String(
    mergedGame.displayName ?? mergedGame.name ?? ""
  );
  const gameSlug = String(mergedGame.slug ?? "");
  const gameImageUrl = resolveGameImageUrl({
    game: mergedGame,
    gameName,
    gameSlug,
  });

  return {
    id,
    name: String(campaign.name ?? base.name ?? ""),
    gameName,
    gameSlug,
    gameImageUrl,
    status: String(campaign.status ?? base.status ?? "ACTIVE"),
    linked: Boolean(asRecord(campaign.self ?? base.self).isAccountConnected ?? true),
    startsAt: String(campaign.startAt ?? base.startAt ?? ""),
    endsAt: String(campaign.endAt ?? base.endsAt ?? ""),
    drops,
    channels,
  };
}

export function parseDropProgress(msg: Record<string, unknown>): {
  type: string;
  dropId: string;
  currentMinutes: number;
  requiredMinutes: number;
  dropInstanceId?: string;
} | null {
  const type = msg.type as string | undefined;
  if (type !== "drop-progress" && type !== "drop-claim") return null;
  const data = asRecord(msg.data);
  return {
    type,
    dropId: String(data.drop_id ?? ""),
    currentMinutes: Number(data.current_progress_min ?? 0),
    requiredMinutes: Number(data.required_progress_min ?? 0),
    dropInstanceId: data.drop_instance_id ? String(data.drop_instance_id) : undefined,
  };
}

/** Collect campaign list entries from Twitch GQL (matches TwitchDropsMiner fetch_inventory). */
const SOURCE_CACHE_TTL_MS = 5 * 60_000;
const sourceCache = new Map<
  string,
  { expires: number; value: Awaited<ReturnType<typeof fetchCampaignSourceMapUncached>> }
>();

export function invalidateCampaignSourceCache(userId: string) {
  sourceCache.delete(userId);
}

async function fetchCampaignSourceMapUncached(auth: TwitchAuthSession): Promise<{
  gql: GqlClient;
  byId: Map<string, Record<string, unknown>>;
  claimedBenefits: Map<string, number>;
}> {
  const gql = new GqlClient(auth);
  const [invResult, campResult] = await Promise.all([gql.inventory(), gql.campaigns()]);

  const inventory = asRecord(asRecord(asRecord(invResult.data).currentUser).inventory);
  const claimedBenefits = parseClaimedBenefits(inventory);

  const inProgress = asArray<Record<string, unknown>>(inventory.dropCampaignsInProgress);
  const rewardCampaigns = asArray<Record<string, unknown>>(inventory.dropCampaigns);

  const campData = asRecord(campResult.data);
  const currentUser = asRecord(campData.currentUser);
  const viewer = asRecord(campData.viewer);
  const availableRaw = asArray<Record<string, unknown>>(
    currentUser.dropCampaigns ?? viewer.dropCampaigns
  );
  const available = availableRaw.filter((c) => {
    const status = String(c.status ?? "");
    return status === "ACTIVE" || status === "UPCOMING";
  });

  const byId = new Map<string, Record<string, unknown>>();
  for (const c of [...inProgress, ...available, ...rewardCampaigns]) {
    const id = String(c.id ?? "");
    if (id) byId.set(id, c);
  }

  return { gql, byId, claimedBenefits };
}

export async function fetchCampaignSourceMap(auth: TwitchAuthSession): Promise<{
  gql: GqlClient;
  byId: Map<string, Record<string, unknown>>;
  claimedBenefits: Map<string, number>;
}> {
  const cacheKey = auth.userId;
  const now = Date.now();
  const hit = sourceCache.get(cacheKey);
  if (hit && hit.expires > now) {
    return hit.value;
  }
  const value = await fetchCampaignSourceMapUncached(auth);
  sourceCache.set(cacheKey, { expires: now + SOURCE_CACHE_TTL_MS, value });
  return value;
}

export async function fetchAllCampaignsSummary(auth: TwitchAuthSession): Promise<CampaignSummary[]> {
  const { byId } = await fetchCampaignSourceMap(auth);

  const bySummary = new Map<string, CampaignSummary>();
  for (const raw of byId.values()) {
    const summary = parseCampaignSummary(raw);
    if (summary.id) bySummary.set(summary.id, summary);
  }

  return enrichGameImages(
    [...bySummary.values()]
      .filter((c) => c.status !== "EXPIRED")
      .sort((a, b) => a.gameName.localeCompare(b.gameName) || a.name.localeCompare(b.name))
  );
}

function finalizeCampaigns(campaigns: CampaignInfo[]): CampaignInfo[] {
  return enrichCampaignGameImages(sortCampaignsForDisplay(campaigns));
}

export { finalizeCampaigns };

async function fetchCampaignDetailBatch(
  gql: GqlClient,
  viewerKey: string,
  ids: string[],
  byId: Map<string, Record<string, unknown>>,
  claimedBenefits: Map<string, number>,
  chunkSize = CAMPAIGN_DETAILS_CHUNK_SIZE
): Promise<CampaignInfo[]> {
  if (ids.length === 0) return [];

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }

  const chunkResults = await Promise.all(
    chunks.map(async (chunk) => {
      const campaigns: CampaignInfo[] = [];
      try {
        const results = await gql.campaignDetailsBatch(viewerKey, chunk);
        for (let j = 0; j < chunk.length; j++) {
          const id = chunk[j];
          const fallback = byId.get(id);
          const result = results[j] as Record<string, unknown> | undefined;
          try {
            if (!result || result.errors) {
              if (fallback) {
                campaigns.push(parseCampaignFromDetail(id, {}, fallback, claimedBenefits));
              }
              continue;
            }
            const campaign = asRecord(asRecord(asRecord(result.data).user).dropCampaign);
            if (!campaign || Object.keys(campaign).length === 0) {
              if (fallback) {
                campaigns.push(parseCampaignFromDetail(id, {}, fallback, claimedBenefits));
              }
              continue;
            }
            campaigns.push(parseCampaignFromDetail(id, campaign, fallback, claimedBenefits));
          } catch {
            if (fallback) {
              campaigns.push(parseCampaignFromDetail(id, {}, fallback, claimedBenefits));
            }
          }
        }
      } catch {
        for (const id of chunk) {
          const fallback = byId.get(id);
          if (fallback) {
            campaigns.push(parseCampaignFromDetail(id, {}, fallback, claimedBenefits));
          }
        }
      }
      return campaigns;
    })
  );

  return finalizeCampaigns(chunkResults.flat());
}

/** Build campaigns from list payloads only (2 GQL calls — no per-campaign details). */
export function buildCampaignsFromList(
  byId: Map<string, Record<string, unknown>>,
  claimedBenefits: Map<string, number>
): CampaignInfo[] {
  const campaigns: CampaignInfo[] = [];
  for (const [id, raw] of byId) {
    campaigns.push(parseCampaignFromDetail(id, {}, raw, claimedBenefits));
  }
  return finalizeCampaigns(campaigns);
}

export async function fetchInventoryQuick(auth: TwitchAuthSession): Promise<CampaignInfo[]> {
  const { byId, claimedBenefits } = await fetchCampaignSourceMap(auth);
  return buildCampaignsFromList(byId, claimedBenefits);
}

export async function fetchCampaignDetail(
  auth: TwitchAuthSession,
  campaignId: string
): Promise<CampaignInfo | null> {
  const gql = new GqlClient(auth);
  try {
    const detail = await gql.campaignDetails(auth.userId, campaignId);
    const campaign = asRecord(asRecord(asRecord(detail.data).user).dropCampaign);
    if (!campaign || Object.keys(campaign).length === 0) return null;
    return parseCampaignFromDetail(campaignId, campaign);
  } catch {
    return null;
  }
}

export async function fetchInventory(
  auth: TwitchAuthSession,
  options: { quick?: boolean } = {}
): Promise<CampaignInfo[]> {
  const { gql, byId, claimedBenefits } = await fetchCampaignSourceMap(auth);
  if (options.quick) {
    return buildCampaignsFromList(byId, claimedBenefits);
  }
  const ids = [...byId.keys()];
  return fetchCampaignDetailBatch(gql, auth.userId, ids, byId, claimedBenefits);
}

export async function enrichChannelsOnline(
  auth: TwitchAuthSession,
  channels: ChannelInfo[]
): Promise<ChannelInfo[]> {
  const unique = new Map<string, ChannelInfo>();
  for (const ch of channels) unique.set(ch.login.toLowerCase(), { ...ch });

  const list = [...unique.values()];
  const concurrency = 12;
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (ch) => {
        try {
          const info = await fetchStreamInfo(auth, ch.login);
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
        } catch {
          ch.online = false;
        }
      })
    );
  }

  return list;
}

export async function discoverGameChannels(
  auth: TwitchAuthSession,
  gameSlug: string,
  campaignId: string
): Promise<ChannelInfo[]> {
  const gql = new GqlClient(auth);
  try {
    const result = await gql.gameDirectory(gameSlug);
    const items = asArray<Record<string, unknown>>(
      asRecord(asRecord(asRecord(result.data).game).streams).edges
    );
    return items.map((edge) => {
      const node = asRecord(edge.node);
      const broadcaster = asRecord(node.broadcaster);
      const game = asRecord(node.game);
      return {
        id: String(broadcaster.id ?? ""),
        login: String(broadcaster.login ?? ""),
        displayName: String(broadcaster.displayName ?? broadcaster.login ?? ""),
        gameName: String(game.displayName ?? game.name ?? ""),
        gameSlug: String(game.slug ?? gameSlug),
        gameId: String(game.id ?? ""),
        online: true,
        viewers: Number(node.viewersCount ?? 0),
        campaignIds: [campaignId],
        aclPreferred: false,
        dropsEnabled: true,
      };
    });
  } catch {
    return [];
  }
}

export function mergeChannels(all: ChannelInfo[]): ChannelInfo[] {
  const map = new Map<string, ChannelInfo>();
  for (const ch of all) {
    const key = ch.login.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...ch, campaignIds: [...ch.campaignIds] });
      continue;
    }
    existing.campaignIds = [...new Set([...existing.campaignIds, ...ch.campaignIds])];
    existing.viewers = Math.max(existing.viewers, ch.viewers);
    existing.online = existing.online || ch.online;
    existing.aclPreferred = existing.aclPreferred || ch.aclPreferred;
    if (!existing.id && ch.id) existing.id = ch.id;
  }
  return [...map.values()];
}

/** Drop still needs mining or claiming (excludes sub-only / zero-minute drops). */
export function campaignHasEarnableDrops(campaign: CampaignInfo): boolean {
  return campaign.drops.some((d) => d.requiredMinutes > 0 && !d.isClaimed);
}

export function campaignIsFinished(campaign: CampaignInfo): boolean {
  if (campaign.drops.length === 0) return false;
  return campaign.drops.every((d) => d.isClaimed || d.requiredMinutes <= 0);
}

export function filterCampaignsForMining(
  campaigns: CampaignInfo[],
  excludeGames: string[],
  priorityGames: string[],
  priorityMode: PriorityMode
): CampaignInfo[] {
  let filtered = campaigns.filter((c) => c.status !== "EXPIRED");
  filtered = filtered.filter((c) => c.linked && campaignHasEarnableDrops(c));
  filtered = filtered.filter((c) => !excludeGames.some((g) => g.toLowerCase() === c.gameName.toLowerCase()));

  if (priorityMode === "PRIORITY_ONLY") {
    filtered = filtered.filter((c) =>
      priorityGames.some((g) => g.toLowerCase() === c.gameName.toLowerCase())
    );
  }

  filtered.sort((a, b) => {
    const pa = priorityGames.findIndex((g) => g.toLowerCase() === a.gameName.toLowerCase());
    const pb = priorityGames.findIndex((g) => g.toLowerCase() === b.gameName.toLowerCase());
    const aPri = pa === -1 ? 999 : pa;
    const bPri = pb === -1 ? 999 : pb;
    if (aPri !== bPri) return aPri - bPri;
    if (priorityMode === "ENDING_SOONEST") {
      return new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime();
    }
    if (priorityMode === "LOW_AVBL_FIRST") {
      const aDone = a.drops.filter((d) => d.isComplete).length;
      const bDone = b.drops.filter((d) => d.isComplete).length;
      return aDone - bDone;
    }
    return 0;
  });

  return filtered;
}

/** Pinned campaign if still eligible, otherwise highest-priority mining campaign. */
export function resolveFocusedCampaign(
  miningCampaigns: CampaignInfo[],
  activeCampaignId: string | null
): CampaignInfo | null {
  if (miningCampaigns.length === 0) return null;
  if (activeCampaignId) {
    const pinned = miningCampaigns.find((c) => c.id === activeCampaignId);
    if (pinned) return pinned;
  }
  return miningCampaigns[0];
}

/** @deprecated use filterCampaignsForMining */
export function filterCampaigns(
  campaigns: CampaignInfo[],
  _selectedIds: string[],
  excludeGames: string[],
  priorityGames: string[],
  priorityMode: PriorityMode
): CampaignInfo[] {
  return filterCampaignsForMining(campaigns, excludeGames, priorityGames, priorityMode);
}

export function sortCampaignsForDisplay(campaigns: CampaignInfo[]): CampaignInfo[] {
  return [...campaigns]
    .filter((c) => c.status !== "EXPIRED")
    .sort((a, b) => {
      const aProgress = a.drops.some((d) => d.currentMinutes > 0 && !d.isComplete);
      const bProgress = b.drops.some((d) => d.currentMinutes > 0 && !d.isComplete);
      if (aProgress !== bProgress) return aProgress ? -1 : 1;
      const aActive = a.status === "ACTIVE";
      const bActive = b.status === "ACTIVE";
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.gameName.localeCompare(b.gameName) || a.name.localeCompare(b.name);
    });
}

export function mergeCampaignProgress(existing: CampaignInfo[], incoming: CampaignInfo[]): CampaignInfo[] {
  const progressByDrop = new Map<
    string,
    { currentMinutes: number; isComplete: boolean; isClaimed: boolean; claimId?: string }
  >();
  for (const c of existing) {
    for (const d of c.drops) {
      progressByDrop.set(d.id, {
        currentMinutes: d.currentMinutes,
        isComplete: d.isComplete,
        isClaimed: d.isClaimed,
        claimId: d.claimId,
      });
    }
  }

  return enrichCampaignGameImages(
    incoming.map((campaign) => {
      const prev = existing.find((e) => e.id === campaign.id);
      const peerImage =
        existing.find(
          (e) =>
            e.gameImageUrl &&
            e.gameName.toLowerCase() === campaign.gameName.toLowerCase()
        )?.gameImageUrl ?? "";

      return {
        ...campaign,
        gameImageUrl: campaign.gameImageUrl || prev?.gameImageUrl || peerImage,
        drops: campaign.drops.map((drop) => {
          const prevDrop = progressByDrop.get(drop.id);
          if (!prevDrop) {
            return {
              ...drop,
              imageUrl: drop.imageUrl || campaign.gameImageUrl || prev?.gameImageUrl || peerImage,
            };
          }
          const isClaimed = drop.isClaimed || prevDrop.isClaimed;
          const currentMinutes = Math.max(drop.currentMinutes, prevDrop.currentMinutes);
          const required = drop.requiredMinutes;
          const gameImg = campaign.gameImageUrl || prev?.gameImageUrl || peerImage;
          return {
            ...drop,
            claimId: drop.claimId ?? prevDrop.claimId,
            isClaimed,
            currentMinutes: isClaimed && required > 0 ? required : currentMinutes,
            isComplete: isClaimed || drop.isComplete || prevDrop.isComplete,
            imageUrl: drop.imageUrl || gameImg,
          };
        }),
      };
    })
  );
}

export function buildClaimId(userId: string, campaignId: string, dropId: string): string {
  return `${userId}#${campaignId}#${dropId}`;
}

export function dropCanClaim(
  drop: CampaignInfo["drops"][number],
  campaign: CampaignInfo,
  nowMs = Date.now()
): boolean {
  if (drop.isClaimed) return false;
  const endGrace = new Date(campaign.endsAt).getTime() + 24 * 60 * 60 * 1000;
  if (nowMs >= endGrace) return false;
  const watchDone =
    drop.requiredMinutes <= 0 || drop.currentMinutes >= drop.requiredMinutes;
  return Boolean(drop.claimId || drop.canClaim || watchDone);
}

export function resolveClaimId(
  auth: TwitchAuthSession,
  drop: CampaignInfo["drops"][number],
  campaignId: string
): string | null {
  if (drop.claimId) return drop.claimId;
  if (
    drop.canClaim ||
    (drop.requiredMinutes > 0 && drop.currentMinutes >= drop.requiredMinutes)
  ) {
    return buildClaimId(auth.userId, campaignId, drop.id);
  }
  return null;
}

export function channelMatchesCampaigns(ch: ChannelInfo, campaigns: CampaignInfo[]): boolean {
  if (campaigns.length === 0) return false;
  const names = new Set(campaigns.map((c) => c.gameName.toLowerCase()).filter(Boolean));
  const slugs = new Set(campaigns.map((c) => c.gameSlug.toLowerCase()).filter(Boolean));
  const gn = ch.gameName.toLowerCase();
  const gs = ch.gameSlug.toLowerCase();
  if (!gn && !gs) return false;
  return names.has(gn) || Boolean(gs && slugs.has(gs));
}

/** Lower index = higher priority (matches TDM wanted_games order). */
export function gamePriorityRank(gameName: string, priorityGames: string[]): number {
  if (!gameName) return 999;
  const gn = gameName.toLowerCase();
  const idx = priorityGames.findIndex((g) => g.toLowerCase() === gn);
  return idx === -1 ? 999 : idx;
}

/** Best (lowest) priority rank among mining campaigns this channel can serve. */
export function channelPriorityRank(
  ch: ChannelInfo,
  campaigns: CampaignInfo[],
  priorityGames: string[]
): number {
  let best = 999;
  const gn = ch.gameName.toLowerCase();
  const gs = ch.gameSlug.toLowerCase();
  for (const c of campaigns) {
    const cn = c.gameName.toLowerCase();
    const cs = c.gameSlug.toLowerCase();
    const matches =
      (gn && cn === gn) || (gs && cs && gs === cs) || (gn && cs === gn) || (gs && cn === gs);
    if (!matches) continue;
    best = Math.min(best, gamePriorityRank(c.gameName, priorityGames));
  }
  if (best < 999) return best;
  return gamePriorityRank(ch.gameName, priorityGames);
}

/** TDM should_switch — switch when candidate game is higher priority or same + ACL. */
export function shouldSwitchChannel(
  candidate: ChannelInfo,
  watching: ChannelInfo,
  campaigns: CampaignInfo[],
  priorityGames: string[]
): boolean {
  const candRank = channelPriorityRank(candidate, campaigns, priorityGames);
  const watchRank = channelPriorityRank(watching, campaigns, priorityGames);
  if (candRank < watchRank) return true;
  if (candRank > watchRank) return false;
  if (candidate.aclPreferred && !watching.aclPreferred) return true;
  return false;
}

export function pickBestChannel(
  channels: ChannelInfo[],
  campaigns: CampaignInfo[],
  manualLogin: string | null,
  preferLogin: string | null = null,
  priorityGames: string[] = []
): ChannelInfo | null {
  if (manualLogin) {
    const manual = channels.find(
      (c) =>
        c.login.toLowerCase() === manualLogin.toLowerCase() &&
        c.online &&
        c.dropsEnabled === true
    );
    if (manual) return manual;
  }

  let online = channels.filter((c) => c.online && c.dropsEnabled === true);
  if (online.length === 0) return null;

  const needsGame = campaigns.some((c) => c.gameName || c.gameSlug);
  if (needsGame) {
    online = online.filter((c) => channelMatchesCampaigns(c, campaigns));
  }
  if (online.length === 0) return null;

  online.sort((a, b) => {
    const pa = channelPriorityRank(a, campaigns, priorityGames);
    const pb = channelPriorityRank(b, campaigns, priorityGames);
    if (pa !== pb) return pa - pb;
    if (a.aclPreferred !== b.aclPreferred) return a.aclPreferred ? -1 : 1;
    const aShared = a.campaignIds.length;
    const bShared = b.campaignIds.length;
    if (aShared !== bShared) return bShared - aShared;
    return b.viewers - a.viewers;
  });

  const best = online[0];
  if (preferLogin && best) {
    const current = online.find((c) => c.login.toLowerCase() === preferLogin.toLowerCase());
    if (current && !shouldSwitchChannel(best, current, campaigns, priorityGames)) {
      return current;
    }
  }

  return best;
}

export function findDropInCampaigns(
  campaigns: CampaignInfo[],
  dropId: string
): { drop: CampaignInfo["drops"][number]; campaign: CampaignInfo } | null {
  for (const campaign of campaigns) {
    const drop = campaign.drops.find((d) => d.id === dropId);
    if (drop) return { drop, campaign };
  }
  return null;
}

export function applyDropProgress(
  campaigns: CampaignInfo[],
  dropId: string,
  currentMinutes: number,
  requiredMinutes?: number
): DropProgress | null {
  const found = findDropInCampaigns(campaigns, dropId);
  if (!found) return null;

  found.drop.currentMinutes = currentMinutes;
  if (requiredMinutes && requiredMinutes > 0) {
    found.drop.requiredMinutes = requiredMinutes;
  }
  if (found.drop.requiredMinutes > 0 && currentMinutes >= found.drop.requiredMinutes) {
    found.drop.isComplete = true;
    found.drop.canClaim = true;
  }

  return {
    dropId,
    dropName: found.drop.name,
    campaignId: found.campaign.id,
    campaignName: found.campaign.name,
    gameName: found.campaign.gameName,
    imageUrl: found.drop.imageUrl || found.campaign.gameImageUrl,
    gameImageUrl: found.campaign.gameImageUrl,
    currentMinutes,
    requiredMinutes: found.drop.requiredMinutes,
    isComplete: found.drop.isComplete,
  };
}

export async function claimDrop(auth: TwitchAuthSession, dropInstanceId: string): Promise<boolean> {
  const gql = new GqlClient(auth);
  try {
    const result = await gql.claimDrop(dropInstanceId);
    const claimResult = asRecord(asRecord(result.data).claimDropRewards);
    const status = claimResult.status;
    const code = typeof status === "string" ? status : String(asRecord(status).code ?? "");
    return code === "ELIGIBLE_FOR_ALL" || code === "DROP_INSTANCE_ALREADY_CLAIMED";
  } catch {
    return false;
  }
}
