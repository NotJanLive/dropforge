import { GQL_URL, getClientType, type RewardQueueEntry } from "./constants.js";
import { GqlClient } from "./gql.js";
import type { TwitchAuthSession } from "../twitch/auth.js";

/**
 * Rewards outside regular game drops.
 *
 * Twitch's newer drop campaigns ("drops v3") are made of reward groups. Each
 * group has its own requirement — watch N minutes (`WATCH`) or gift subs
 * (`SUB`) — and its own rewards (badge, emote, game item, or a chest that
 * draws one from a pool). Two kinds are not covered by the game drop miner:
 *
 * - Reward campaigns: global campaigns without a game, e.g. "GTAVI Launch
 *   Celebration". Watch time counts on any channel in the listed categories.
 *   They are listed by `dropsCampaigns`.
 * - Creator badge drops: channel-owned campaigns (`brandName =
 *   CREATOR_LED_BADGE_CAMPAIGN`). Watch time counts only on that channel.
 *   They are not listed globally; `channelOwnedDropCampaigns` has to be asked
 *   per channel, so the directory scans the top live streams.
 */

export const CREATOR_BADGE_BRAND = "CREATOR_LED_BADGE_CAMPAIGN";

/** Top live streams (all languages) checked for creator badges per scan. */
const SCAN_STREAMS = 3000;
const STREAMS_PAGE_SIZE = 30;
const CHANNELS_PER_QUERY = 50;
const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const LIVE_REFRESH_MS = 2 * 60 * 1000;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

export type RewardKind = "channel" | "category";

export interface RewardItem {
  name: string;
  /** BADGE, EMOTE, DIRECT_ENTITLEMENT, POOL, … */
  type: string;
  imageUrl: string;
  /** For POOL (chest) rewards: what the chest can contain. */
  pool: Array<{ name: string; type: string; imageUrl: string }>;
}

export interface RewardGroupInfo {
  /** Queue id: `${campaignId}:${groupId}` */
  id: string;
  groupId: string;
  name: string;
  requirementType: string;
  minutesWatched: number;
  subs: number;
  /** How often it can be earned (repeatable groups), null = once. */
  repeatTimes: number | null;
  resetSeconds: number | null;
  rewards: RewardItem[];
  /** Watch-time requirement — can be mined. */
  mineable: boolean;
}

export interface RewardCampaign {
  id: string;
  kind: RewardKind;
  name: string;
  brandName: string;
  imageUrl: string;
  detailsUrl: string;
  startsAt: string;
  endsAt: string;
  categoryIds: string[];
  categoryNames: string[];
  /** Only for creator badge (channel) campaigns. */
  channel: {
    id: string;
    login: string;
    displayName: string;
    imageUrl: string;
    live: boolean;
    viewers: number;
    gameName: string;
  } | null;
  groups: RewardGroupInfo[];
}

export interface RewardProgress {
  status: string;
  currentMinutes: number;
  requiredMinutes: number;
  grantCount: number;
  nextEligibleAt: string | null;
}

async function publicGqlOnce(query: string, variables: Json): Promise<Json> {
  const client = getClientType();
  const res = await fetch(GQL_URL, {
    method: "POST",
    headers: {
      "Client-Id": client.clientId,
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GQL request failed: ${res.status}`);
  const data = asRecord(await res.json());
  const errors = asArray(data.errors);
  if (errors.length > 0 && !data.data) {
    throw new Error(String(errors[0].message ?? "GQL error"));
  }
  return data;
}

/** Unauthenticated GQL for public data, retried on transient failures. */
async function publicGql(query: string, variables: Json = {}): Promise<Json> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await publicGqlOnce(query, variables);
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

const CAMPAIGN_FIELDS = `
  id name brandName status startAt endAt imageURL detailsURL
  game { id }
  rewardGroups {
    id name
    progressCriteria {
      requirementType
      requirements { minutesWatched subs }
      isRepeatable
      repeatableConfig { repeatableTimes resetIntervalSeconds }
      categories { id displayName }
    }
    rewards {
      name thumbnailURL distributionType
      pool { rewards { name thumbnailURL distributionType } }
    }
  }
`;

const GLOBAL_CAMPAIGNS_QUERY = `query DropforgeRewardCampaigns { dropsCampaigns(includeUpcoming: false) { ${CAMPAIGN_FIELDS} } }`;

const OWNED_CAMPAIGNS_QUERY = `
  query DropforgeCreatorBadges($ids: [ID!]!) {
    channelOwnedDropCampaigns(channelIDs: $ids) {
      channel { id }
      campaigns { ${CAMPAIGN_FIELDS} }
    }
  }
`;

const CHANNEL_INFO_QUERY = `
  query DropforgeRewardChannels($ids: [ID!]) {
    users(ids: $ids) {
      id login displayName profileImageURL(width: 70)
      stream { id viewersCount game { id displayName } }
    }
  }
`;

const SELF_FIELDS = `self { status currentMinutesWatched grantCount nextEligibleAt }`;

const CHANNEL_PROGRESS_QUERY = `
  query DropforgeChannelRewardProgress($channelID: ID!) {
    channelDropCampaignsProgress(channelID: $channelID) {
      id
      rewardGroups { id progressCriteria { requirements { minutesWatched } } ${SELF_FIELDS} }
    }
  }
`;

const CAMPAIGN_PROGRESS_QUERY = `
  query DropforgeCampaignRewardProgress($id: ID!) {
    dropsCampaign(id: $id) {
      id
      rewardGroups { id progressCriteria { requirements { minutesWatched } } ${SELF_FIELDS} }
    }
  }
`;

const CATEGORY_STREAMS_QUERY = `
  query DropforgeCategoryStreams($id: ID!) {
    game(id: $id) {
      streams(first: 20) {
        edges { node { viewersCount broadcaster { id login displayName } } }
      }
    }
  }
`;

function isActive(c: Json, now = Date.now()): boolean {
  if (c.status && c.status !== "ACTIVE") return false;
  const end = Date.parse(String(c.endAt ?? ""));
  const start = Date.parse(String(c.startAt ?? ""));
  if (Number.isFinite(end) && end <= now) return false;
  if (Number.isFinite(start) && start > now) return false;
  return true;
}

function parseReward(r: Json): RewardItem {
  return {
    name: String(r.name ?? ""),
    type: String(r.distributionType ?? ""),
    imageUrl: String(r.thumbnailURL ?? ""),
    pool: asArray(asRecord(r.pool).rewards).map((p) => ({
      name: String(p.name ?? ""),
      type: String(p.distributionType ?? ""),
      imageUrl: String(p.thumbnailURL ?? ""),
    })),
  };
}

function parseCampaign(c: Json, kind: RewardKind): RewardCampaign {
  const categoryIds = new Set<string>();
  const categoryNames = new Set<string>();
  const groups: RewardGroupInfo[] = asArray(c.rewardGroups).map((g) => {
    const pc = asRecord(g.progressCriteria);
    const req = asRecord(pc.requirements);
    const repeat = asRecord(pc.repeatableConfig);
    for (const cat of asArray(pc.categories)) {
      categoryIds.add(String(cat.id));
      categoryNames.add(String(cat.displayName ?? ""));
    }
    const minutes = Number(req.minutesWatched ?? 0) || 0;
    const requirementType = String(pc.requirementType ?? "");
    return {
      id: `${c.id}:${g.id}`,
      groupId: String(g.id),
      name: String(g.name ?? ""),
      requirementType,
      minutesWatched: minutes,
      subs: Number(req.subs ?? 0) || 0,
      repeatTimes: pc.isRepeatable ? Number(repeat.repeatableTimes ?? 0) || null : null,
      resetSeconds: pc.isRepeatable ? Number(repeat.resetIntervalSeconds ?? 0) || null : null,
      rewards: asArray(g.rewards).map(parseReward),
      mineable: requirementType === "WATCH" && minutes > 0,
    };
  });
  return {
    id: String(c.id),
    kind,
    name: String(c.name ?? ""),
    brandName: String(c.brandName ?? ""),
    imageUrl: String(c.imageURL ?? ""),
    detailsUrl: String(c.detailsURL ?? ""),
    startsAt: String(c.startAt ?? ""),
    endsAt: String(c.endAt ?? ""),
    categoryIds: [...categoryIds],
    categoryNames: [...categoryNames].filter(Boolean),
    channel: null,
    groups,
  };
}

/** Chests use a generic placeholder image — show what is inside instead. */
export function rewardImage(r: RewardItem | undefined): string {
  if (!r) return "";
  if (r.pool.length > 0 && (!r.imageUrl || r.imageUrl.endsWith("/default.png"))) return r.pool[0].imageUrl;
  return r.imageUrl;
}

/** Categories one reward group must be watched in (empty = any). */
function groupCategories(raw: Json, groupId: string): { ids: string[]; names: string[] } {
  const g = asArray(raw.rewardGroups).find((x) => String(x.id) === groupId);
  const cats = asArray(asRecord(g?.progressCriteria).categories);
  return { ids: cats.map((x) => String(x.id)), names: cats.map((x) => String(x.displayName ?? "")) };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ChannelMeta {
  login: string;
  displayName: string;
  imageUrl: string;
  live: boolean;
  viewers: number;
  gameName: string;
}

/** Server-wide list of active reward campaigns. Public data, one scan for all users. */
class RewardDirectory {
  /** Raw campaign JSON by id, with the owning channel for creator badges. */
  private campaigns = new Map<string, { raw: Json; kind: RewardKind; channelId: string | null }>();
  private channels = new Map<string, ChannelMeta>();
  /** Channels a user queued or looked up — always included in scans. */
  private tracked = new Set<string>();
  private scanTimer: NodeJS.Timeout | null = null;
  private liveTimer: NodeJS.Timeout | null = null;
  private scanning: Promise<void> | null = null;
  private lastScanAt: string | null = null;
  private lastScanError: string | null = null;
  private scannedStreams = 0;

  start() {
    if (this.scanTimer) return;
    void this.scan();
    this.scanTimer = setInterval(() => void this.scan(), SCAN_INTERVAL_MS);
    this.liveTimer = setInterval(() => void this.refreshLive(), LIVE_REFRESH_MS);
  }

  track(channelIds: Iterable<string>) {
    for (const id of channelIds) if (/^\d+$/.test(id)) this.tracked.add(id);
  }

  info() {
    return {
      lastScanAt: this.lastScanAt,
      scanning: this.scanning !== null,
      scannedStreams: this.scannedStreams,
      error: this.lastScanError,
    };
  }

  list(): RewardCampaign[] {
    const now = Date.now();
    const out: RewardCampaign[] = [];
    for (const { raw, kind, channelId } of this.campaigns.values()) {
      if (!isActive(raw, now)) continue;
      const c = parseCampaign(raw, kind);
      if (kind === "channel") {
        // Creator badges: only groups that can be mined matter for the queue,
        // but sub groups stay visible as information.
        if (!c.groups.some((g) => g.mineable)) continue;
        c.channel = this.channelView(channelId!);
      }
      out.push(c);
    }
    return out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "category" ? -1 : 1;
      const la = a.channel?.live ? 1 : 0;
      const lb = b.channel?.live ? 1 : 0;
      return lb - la || (b.channel?.viewers ?? 0) - (a.channel?.viewers ?? 0);
    });
  }

  /** Queue snapshot for one mineable reward group, or null if unknown. */
  entry(id: string): RewardQueueEntry | null {
    const [campaignId, groupId] = id.split(":");
    const stored = this.campaigns.get(campaignId);
    if (!stored || !groupId) return null;
    const c = parseCampaign(stored.raw, stored.kind);
    const g = c.groups.find((x) => x.groupId === groupId);
    if (!g || !g.mineable) return null;
    const reward = g.rewards[0];
    const types = new Set<string>();
    for (const r of g.rewards) {
      if (r.type === "POOL") {
        types.add("CHEST");
        for (const p of r.pool) types.add(p.type);
      } else types.add(r.type);
    }
    const cats = groupCategories(stored.raw, groupId);
    const ch = stored.channelId ? this.channelView(stored.channelId) : null;
    if (stored.kind === "channel" && !ch?.login) return null;
    return {
      id,
      kind: stored.kind,
      campaignId,
      rewardGroupId: groupId,
      campaignName: c.name,
      groupName: g.name,
      rewardName: reward?.name || g.name || c.name,
      rewardImageUrl: rewardImage(reward) || c.imageUrl,
      rewardTypes: [...types],
      channelId: ch?.id ?? "",
      channelLogin: ch?.login ?? "",
      channelDisplayName: ch?.displayName ?? "",
      channelImageUrl: ch?.imageUrl ?? "",
      requiredMinutes: g.minutesWatched,
      categoryIds: cats.ids,
      categoryNames: cats.names,
      endsAt: c.endsAt,
      repeatTimes: g.repeatTimes,
      poolItems: g.rewards.flatMap((r) => r.pool.map((p) => ({ name: p.name, imageUrl: p.imageUrl }))),
      preferredChannel: null,
    };
  }

  /** Live state from the last scan or refresh; undefined if never seen. */
  isLive(channelId: string): boolean | undefined {
    return this.channels.get(channelId)?.live;
  }

  setLive(channelId: string, live: boolean) {
    const meta = this.channels.get(channelId);
    if (meta) meta.live = live;
  }

  /** Check one channel by login for creator badges (outside the top streams). */
  async lookup(login: string): Promise<RewardCampaign[]> {
    const data = await publicGql(`query($login: String!) { user(login: $login) { id } }`, {
      login: login.trim().toLowerCase(),
    });
    const id = asRecord(asRecord(data.data).user).id;
    if (!id) throw new Error(`Channel "${login}" not found`);
    const channelId = String(id);
    this.tracked.add(channelId);
    await this.fetchOwnedCampaigns([channelId]);
    await this.refreshChannels([channelId]);
    return this.list().filter((c) => c.channel?.id === channelId);
  }

  scan(): Promise<void> {
    if (this.scanning) return this.scanning;
    this.scanning = this.runScan()
      .then(() => {
        this.lastScanError = null;
      })
      .catch((err) => {
        this.lastScanError = err instanceof Error ? err.message : "Scan failed";
        console.warn(`Reward scan failed: ${this.lastScanError}`);
      })
      .finally(() => {
        this.scanning = null;
        this.lastScanAt = new Date().toISOString();
      });
    return this.scanning;
  }

  private channelView(channelId: string): NonNullable<RewardCampaign["channel"]> {
    const m = this.channels.get(channelId);
    return {
      id: channelId,
      login: m?.login ?? "",
      displayName: m?.displayName || m?.login || "",
      imageUrl: m?.imageUrl ?? "",
      live: m?.live ?? false,
      viewers: m?.viewers ?? 0,
      gameName: m?.gameName ?? "",
    };
  }

  private async runScan() {
    await this.fetchGlobalCampaigns();

    const ids = new Set<string>(this.tracked);
    let cursor: string | null = null;
    let streams = 0;
    while (streams < SCAN_STREAMS) {
      const data = await publicGql(
        `query($after: Cursor) {
          streams(first: ${STREAMS_PAGE_SIZE}, after: $after) {
            edges { cursor node { viewersCount game { id displayName }
              broadcaster { id login displayName profileImageURL(width: 70) } } }
          }
        }`,
        { after: cursor }
      );
      const edges = asArray(asRecord(asRecord(data.data).streams).edges);
      if (edges.length === 0) break;
      for (const e of edges) {
        const node = asRecord(e.node);
        const user = asRecord(node.broadcaster);
        if (!user.id) continue;
        const id = String(user.id);
        ids.add(id);
        this.channels.set(id, {
          login: String(user.login ?? ""),
          displayName: String(user.displayName ?? user.login ?? ""),
          imageUrl: String(user.profileImageURL ?? ""),
          live: true,
          viewers: Number(node.viewersCount ?? 0),
          gameName: String(asRecord(node.game).displayName ?? ""),
        });
      }
      streams += edges.length;
      const last = edges[edges.length - 1].cursor;
      if (!last) break;
      cursor = String(last);
    }
    this.scannedStreams = streams;

    // Re-check channels that already had a badge even if they left the top streams.
    for (const c of this.campaigns.values()) if (c.channelId) ids.add(c.channelId);
    await this.fetchOwnedCampaigns([...ids]);
    await this.refreshLive();
  }

  /** Global campaigns without a game — the ones the game drop miner never sees. */
  private async fetchGlobalCampaigns() {
    const data = await publicGql(GLOBAL_CAMPAIGNS_QUERY);
    const list = asArray(asRecord(data.data).dropsCampaigns);
    if (list.length === 0) return;
    for (const [id, c] of this.campaigns) if (c.kind === "category") this.campaigns.delete(id);
    for (const c of list) {
      if (asRecord(c.game).id) continue;
      if (c.brandName === CREATOR_BADGE_BRAND) continue;
      this.campaigns.set(String(c.id), { raw: c, kind: "category", channelId: null });
    }
  }

  private async fetchOwnedCampaigns(channelIds: string[]) {
    const found = new Map<string, { raw: Json; channelId: string }>();
    const queried = new Set<string>();
    let failed = 0;
    let lastError = "";
    await mapLimit(chunk(channelIds, CHANNELS_PER_QUERY), 3, async (ids) => {
      try {
        const data = await publicGql(OWNED_CAMPAIGNS_QUERY, { ids });
        for (const entry of asArray(asRecord(data.data).channelOwnedDropCampaigns)) {
          const channelId = String(asRecord(entry.channel).id ?? "");
          if (!channelId) continue;
          for (const c of asArray(entry.campaigns)) {
            if (c.brandName !== CREATOR_BADGE_BRAND || !isActive(c)) continue;
            found.set(String(c.id), { raw: c, channelId });
          }
        }
        for (const id of ids) queried.add(id);
      } catch (err) {
        failed++;
        lastError = err instanceof Error ? err.message : String(err);
      }
    });
    if (failed > 0) {
      console.warn(`Creator badge lookup failed for ${failed} batch(es): ${lastError}`);
    }

    // A queried channel's campaign that is no longer returned has ended.
    for (const [id, c] of this.campaigns) {
      if (c.channelId && queried.has(c.channelId) && !found.has(id)) this.campaigns.delete(id);
    }
    for (const [id, c] of found) {
      this.campaigns.set(id, { raw: c.raw, kind: "channel", channelId: c.channelId });
    }
  }

  /** Refresh login, avatar and live state of the given channels. */
  async refreshChannels(channelIds: string[]) {
    await mapLimit(chunk(channelIds, CHANNELS_PER_QUERY), 3, async (ids) => {
      try {
        const data = await publicGql(CHANNEL_INFO_QUERY, { ids });
        for (const u of asArray(asRecord(data.data).users)) {
          if (!u?.id) continue;
          const stream = asRecord(u.stream);
          this.channels.set(String(u.id), {
            login: String(u.login ?? ""),
            displayName: String(u.displayName ?? u.login ?? ""),
            imageUrl: String(u.profileImageURL ?? ""),
            live: Boolean(stream.id),
            viewers: Number(stream.viewersCount ?? 0),
            gameName: String(asRecord(stream.game).displayName ?? ""),
          });
        }
      } catch {
        /* keep previous meta */
      }
    });
  }

  /** Refresh live state of every channel that has a badge or is tracked. */
  async refreshLive() {
    const now = Date.now();
    for (const [id, c] of this.campaigns) if (!isActive(c.raw, now)) this.campaigns.delete(id);
    const ids = new Set<string>(this.tracked);
    for (const c of this.campaigns.values()) if (c.channelId) ids.add(c.channelId);
    if (ids.size > 0) await this.refreshChannels([...ids]);
  }
}

export const rewardDirectory = new RewardDirectory();

function parseProgress(groups: Json[]): Map<string, RewardProgress> {
  const out = new Map<string, RewardProgress>();
  for (const g of groups) {
    const self = asRecord(g.self);
    out.set(String(g.id), {
      status: String(self.status ?? "NOT_STARTED"),
      currentMinutes: Number(self.currentMinutesWatched ?? 0),
      requiredMinutes: Number(asRecord(asRecord(g.progressCriteria).requirements).minutesWatched ?? 0),
      grantCount: Number(self.grantCount ?? 0),
      nextEligibleAt: self.nextEligibleAt ? String(self.nextEligibleAt) : null,
    });
  }
  return out;
}

async function authQuery(auth: TwitchAuthSession, query: string, variables: Json): Promise<Json> {
  const gql = new GqlClient(auth);
  const [result] = await gql.request({ query, variables });
  return result;
}

/**
 * The viewer's progress on one queued reward, keyed by reward group id.
 * Creator badges use the channel query Twitch's own drops tray uses; global
 * reward campaigns are read by campaign id.
 */
export async function fetchRewardProgress(
  auth: TwitchAuthSession,
  entry: Pick<RewardQueueEntry, "kind" | "campaignId" | "channelId">
): Promise<Map<string, RewardProgress>> {
  if (entry.kind === "channel") {
    const result = await authQuery(auth, CHANNEL_PROGRESS_QUERY, { channelID: entry.channelId });
    const campaigns = asArray(asRecord(result.data).channelDropCampaignsProgress);
    if (campaigns.length === 0 && asArray(result.errors).length > 0) {
      throw new Error(String(asArray(result.errors)[0].message ?? "GQL error"));
    }
    const c = campaigns.find((x) => String(x.id) === entry.campaignId);
    return parseProgress(asArray(c?.rewardGroups));
  }
  const result = await authQuery(auth, CAMPAIGN_PROGRESS_QUERY, { id: entry.campaignId });
  const c = asRecord(asRecord(result.data).dropsCampaign);
  if (!c.id && asArray(result.errors).length > 0) {
    throw new Error(String(asArray(result.errors)[0].message ?? "GQL error"));
  }
  return parseProgress(asArray(c.rewardGroups));
}

export interface CategoryChannel {
  id: string;
  login: string;
  displayName: string;
  imageUrl: string;
  viewers: number;
  gameName: string;
}

/** Live channels across the categories, most viewers first. */
export async function listCategoryChannels(categoryIds: string[], limit = 40): Promise<CategoryChannel[]> {
  const seen = new Map<string, CategoryChannel>();
  await mapLimit(categoryIds.slice(0, 25), 4, async (id) => {
    try {
      const data = await publicGql(
        `query($id: ID!) { game(id: $id) { displayName streams(first: 25) {
          edges { node { viewersCount broadcaster { id login displayName profileImageURL(width: 70) } } } } } }`,
        { id }
      );
      const game = asRecord(asRecord(data.data).game);
      for (const e of asArray(asRecord(game.streams).edges)) {
        const node = asRecord(e.node);
        const user = asRecord(node.broadcaster);
        const login = String(user.login ?? "");
        if (!login || seen.has(login)) continue;
        seen.set(login, {
          id: String(user.id ?? ""),
          login,
          displayName: String(user.displayName ?? login),
          imageUrl: String(user.profileImageURL ?? ""),
          viewers: Number(node.viewersCount ?? 0),
          gameName: String(game.displayName ?? ""),
        });
      }
    } catch {
      /* skip this category */
    }
  });
  return [...seen.values()].sort((a, b) => b.viewers - a.viewers).slice(0, limit);
}

/** Most-watched live channel streaming one of the categories. */
export async function findCategoryChannel(
  categoryIds: string[],
  exclude: Set<string> = new Set()
): Promise<{ id: string; login: string; displayName: string } | null> {
  let best: { id: string; login: string; displayName: string; viewers: number } | null = null;
  for (const id of categoryIds.slice(0, 10)) {
    try {
      const data = await publicGql(CATEGORY_STREAMS_QUERY, { id });
      const edges = asArray(asRecord(asRecord(asRecord(data.data).game).streams).edges);
      for (const e of edges) {
        const node = asRecord(e.node);
        const user = asRecord(node.broadcaster);
        const login = String(user.login ?? "");
        if (!login || exclude.has(login.toLowerCase())) continue;
        const viewers = Number(node.viewersCount ?? 0);
        if (!best || viewers > best.viewers) {
          best = { id: String(user.id), login, displayName: String(user.displayName ?? login), viewers };
        }
        break;
      }
    } catch {
      /* try the next category */
    }
  }
  return best;
}

/** Claim a finished reward group. Same mutation as game drops, v3 instance id. */
export async function claimReward(
  auth: TwitchAuthSession,
  campaignId: string,
  rewardGroupId: string
): Promise<string> {
  const gql = new GqlClient(auth);
  const result = await gql.claimDrop(`${auth.userId}#${campaignId}#${rewardGroupId}`);
  const claim = asRecord(asRecord(result.data).claimDropRewards);
  const status = claim.status;
  return typeof status === "string" ? status : String(asRecord(status).code ?? "");
}
