export interface AdminUserMinerView {
  userId: number;
  username: string;
  setupComplete: boolean;
  twitchLinked: boolean;
  twitchLogin: string | null;
  minerRunning: boolean;
  status: MinerStatus;
}

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "user";
  mustChangePassword: boolean;
  setupComplete: boolean;
  setupStep: number;
  canRevealPassword?: boolean;
  passwordMode?: "temporary" | "permanent" | "user";
  createdAt?: string;
}

export interface AuthStatus {
  initialized: boolean;
  adminSetupComplete: boolean;
  user: AuthUser | null;
}

export interface MinerLogEntry {
  time: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export interface ActiveMiningView {
  gameName: string;
  gameImageUrl: string;
  campaignId: string;
  campaignName: string;
  campaignProgress: number;
  campaignClaimed: number;
  campaignTotal: number;
  campaignRemainingMinutes: number;
  dropId: string;
  dropName: string;
  dropImageUrl: string;
  dropProgress: number;
  dropCurrentMinutes: number;
  dropRequiredMinutes: number;
  dropRemainingMinutes: number;
  dropRemainingSeconds: number;
  campaignRemainingSeconds: number;
  claimedDrops: CampaignDropView[];
  upcomingDrops: CampaignDropView[];
}

export interface CampaignDropView {
  id: string;
  name: string;
  imageUrl: string;
  requiredMinutes: number;
  currentMinutes: number;
  isComplete: boolean;
  isClaimed?: boolean;
}

export interface MinerStatus {
  state: string;
  message: string;
  watchingChannel: string | null;
  watchingGame: string | null;
  currentDrop: {
    dropId: string;
    dropName: string;
    campaignName: string;
    gameName: string;
    imageUrl: string;
    gameImageUrl: string;
    currentMinutes: number;
    requiredMinutes: number;
    isComplete: boolean;
  } | null;
  activeMining: ActiveMiningView | null;
  campaigns: Array<{
    id: string;
    name: string;
    gameName: string;
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
      canClaim: boolean;
    }>;
    channels: ChannelInfo[];
  }>;
  channels: ChannelInfo[];
  logs: MinerLogEntry[];
  websocketConnections: number;
  lastWatchAt: string | null;
  updatedAt: string;
  activeCampaignId?: string | null;
  focusedCampaignId?: string | null;
  focusedCampaignName?: string | null;
  focusedGameName?: string | null;
  miningCampaignOptions?: MiningCampaignOption[];
  unclaimedDrops?: number;
  rewardQueue?: RewardQueueView[];
  pinnedRewardId?: string | null;
  rewardMining?: RewardQueueView | null;
  rewardHistory?: RewardHistoryEntry[];
}

export interface RewardHistoryEntry {
  rewardId: string;
  kind: RewardKind;
  name: string;
  imageUrl: string;
  fromChest: string | null;
  rewardTypes: string[];
  campaignName: string;
  channelLogin: string;
  grantNumber: number | null;
  claimedAt: string;
  source?: "dropforge" | "twitch";
}

export interface CategoryChannel {
  id: string;
  login: string;
  displayName: string;
  imageUrl: string;
  viewers: number;
  gameName: string;
}

export type RewardKind = "channel" | "category";

export interface RewardItem {
  name: string;
  /** BADGE, EMOTE, DIRECT_ENTITLEMENT, POOL, … */
  type: string;
  imageUrl: string;
  pool: Array<{ name: string; type: string; imageUrl: string }>;
}

export interface RewardGroupInfo {
  id: string;
  groupId: string;
  name: string;
  requirementType: string;
  minutesWatched: number;
  subs: number;
  repeatTimes: number | null;
  resetSeconds: number | null;
  rewards: RewardItem[];
  mineable: boolean;
  autoProgress: boolean;
  completeAllRepeats: boolean;
  laneSiblings: string[];
  self?: RewardSelf;
}

export type RewardAvailability = "available" | "progress" | "claimable" | "roundDone" | "locked" | "earned";

export interface RewardSelf {
  availability: RewardAvailability;
  currentMinutes: number;
  requiredMinutes: number;
  grantCount: number;
  resumeAt: string | null;
  status: string;
}

/** Reward campaign (global, category based) or creator badge campaign (one channel). */
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

export type RewardQueueState = "mining" | "waiting" | "offline" | "paused" | "claimable" | "locked";

export interface RewardQueueView {
  id: string;
  kind: RewardKind;
  campaignId: string;
  rewardGroupId: string;
  campaignName: string;
  groupName: string;
  rewardName: string;
  rewardImageUrl: string;
  rewardTypes: string[];
  channelId: string;
  channelLogin: string;
  channelDisplayName: string;
  channelImageUrl: string;
  requiredMinutes: number;
  currentMinutes: number;
  grantCount: number;
  repeatTimes: number | null;
  categoryNames: string[];
  endsAt: string;
  state: RewardQueueState;
  resumeAt: string | null;
  live: boolean;
  pinned: boolean;
  watchingChannel: string | null;
  preferredChannel?: string | null;
  alongside?: boolean;
  twitchStatus?: string | null;
}

export interface RewardScanInfo {
  lastScanAt: string | null;
  scanning: boolean;
  scannedStreams: number;
  error: string | null;
}

export interface MiningCampaignOption {
  id: string;
  name: string;
  gameName: string;
  gameImageUrl: string;
}

export interface ChannelInfo {
  id: string;
  login: string;
  displayName: string;
  gameName: string;
  online: boolean;
  viewers: number;
  campaignIds: string[];
  aclPreferred: boolean;
  dropsEnabled?: boolean;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
  return data as T;
}

export const api = {
  status: () => request<AuthStatus>("/api/auth/status"),
  setupAdmin: (body: { username: string; password: string; priorityMode?: string }) =>
    request<{ ok: boolean }>("/api/auth/setup/admin", { method: "POST", body: JSON.stringify(body) }),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: AuthUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  changePassword: (body: { currentPassword?: string; newPassword: string }) =>
    request<{ ok: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify(body) }),
  completeAdminStep: (step: number) =>
    request<{ ok: boolean }>("/api/auth/setup/admin/complete-step", {
      method: "POST",
      body: JSON.stringify({ step }),
    }),
  finishAdminSetup: () =>
    request<{ ok: boolean }>("/api/auth/setup/admin/finish", { method: "POST" }),
  completeUserStep: (step: number) =>
    request<{ ok: boolean }>("/api/auth/setup/user/complete-step", {
      method: "POST",
      body: JSON.stringify({ step }),
    }),
  finishUserSetup: () =>
    request<{ ok: boolean }>("/api/auth/setup/user/finish", { method: "POST" }),
  listUsers: () => request<{ users: AuthUser[] }>("/api/auth/users"),
  adminMiners: () => request<{ miners: AdminUserMinerView[] }>("/api/auth/admin/miners"),
  adminReloadMiner: (userId: number) =>
    request<{ ok: boolean; miner: AdminUserMinerView | null }>(
      `/api/auth/admin/miners/${userId}/reload`,
      { method: "POST" }
    ),
  adminRefreshCampaigns: (userId: number) =>
    request<{ ok: boolean; miner: AdminUserMinerView | null }>(
      `/api/auth/admin/miners/${userId}/campaigns/refresh`,
      { method: "POST" }
    ),
  adminStartMiner: (userId: number) =>
    request<{ ok: boolean; miner: AdminUserMinerView | null }>(
      `/api/auth/admin/miners/${userId}/start`,
      { method: "POST" }
    ),
  adminStopMiner: (userId: number) =>
    request<{ ok: boolean; miner: AdminUserMinerView | null }>(
      `/api/auth/admin/miners/${userId}/stop`,
      { method: "POST" }
    ),
  createUser: (body: { username: string; passwordType: "temporary" | "permanent"; password?: string }) =>
    request<{
      ok: boolean;
      username: string;
      passwordType: "temporary" | "permanent";
      password: string;
      canRevealPassword: boolean;
    }>("/api/auth/users", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revealUserPassword: (id: number) =>
    request<{ password: string }>(`/api/auth/users/${id}/password`),
  resetUserPassword: (id: number, body: { passwordType: "temporary" | "permanent"; password?: string }) =>
    request<{
      ok: boolean;
      passwordType: "temporary" | "permanent";
      password: string;
      canRevealPassword: boolean;
    }>(`/api/auth/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/auth/users/${id}`, { method: "DELETE" }),
  globalSettings: () => request<{ priorityMode: string }>("/api/auth/settings/global"),
  updateGlobalSettings: (priorityMode: string) =>
    request<{ ok: boolean }>("/api/auth/settings/global", {
      method: "PUT",
      body: JSON.stringify({ priorityMode }),
    }),
  twitchStatus: () =>
    request<{ linked: boolean; twitchLogin: string | null }>("/api/twitch/status"),
  twitchLinkStart: () =>
    request<{ authorizeUrl: string; browserOpened: boolean }>("/api/twitch/link/start", {
      method: "POST",
    }),
  twitchLinkPoll: () =>
    request<{ status: string; error?: string }>("/api/twitch/link/poll", { method: "POST" }),
  twitchLinkComplete: (redirectUrl: string) =>
    request<{ status: string }>("/api/twitch/link/complete", {
      method: "POST",
      body: JSON.stringify({ redirectUrl }),
    }),
  twitchUnlink: () => request<{ ok: boolean }>("/api/twitch/unlink", { method: "POST" }),
  campaigns: (opts?: { refresh?: boolean }) =>
    request<{
      campaigns: Array<{
        id: string;
        name: string;
        gameName: string;
        gameImageUrl: string;
        status: string;
        linked: boolean;
        startsAt: string;
        endsAt: string;
        dropCount: number;
      }>;
      cached?: boolean;
    }>(`/api/twitch/campaigns${opts?.refresh ? "?refresh=1" : ""}`),
  inventory: (opts?: { refresh?: boolean }) =>
    request<{ campaigns: MinerStatus["campaigns"]; cached?: boolean }>(
      `/api/twitch/inventory${opts?.refresh ? "?refresh=1" : ""}`
    ),
  minerSettings: () =>
    request<{
      priorityMode: string;
      priorityGames: string[];
      excludeGames: string[];
      manualChannelLogin: string | null;
      activeCampaignId: string | null;
    }>("/api/twitch/miner/settings"),
  updateMinerSettings: (body: Record<string, unknown>) =>
    request<{ ok: boolean; status: MinerStatus | null }>("/api/twitch/miner/settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  minerStatus: () =>
    request<{ status: MinerStatus | null; twitchLinked?: boolean }>("/api/twitch/miner/status"),
  minerReload: () => request<{ ok: boolean; status: MinerStatus | null }>("/api/twitch/miner/reload", { method: "POST" }),
  selectCampaign: (campaignId: string | null) =>
    request<{ ok: boolean; status: MinerStatus | null }>("/api/twitch/miner/select-campaign", {
      method: "POST",
      body: JSON.stringify({ campaignId }),
    }),
  rewards: () =>
    request<{ campaigns: RewardCampaign[]; scan: RewardScanInfo }>("/api/twitch/rewards"),
  lookupRewards: (login: string) =>
    request<{ campaigns: RewardCampaign[] }>("/api/twitch/rewards/lookup", {
      method: "POST",
      body: JSON.stringify({ login }),
    }),
  rewardChannels: (id: string) =>
    request<{ channels: CategoryChannel[] }>(`/api/twitch/rewards/channels?id=${encodeURIComponent(id)}`),
  setRewardChannel: (id: string, channel: string | null) =>
    request<{ ok: boolean; status: MinerStatus | null }>("/api/twitch/miner/rewards/channel", {
      method: "PUT",
      body: JSON.stringify({ id, channel }),
    }),
  updateRewardQueue: (queue: string[], pinnedId: string | null) =>
    request<{
      ok: boolean;
      skipped: number;
      rejected: Array<{ id: string; name: string; reason: string }>;
      status: MinerStatus | null;
    }>("/api/twitch/miner/rewards", {
      method: "PUT",
      body: JSON.stringify({ queue, pinnedId }),
    }),
  switchChannel: (channelLogin: string) =>
    request<{ ok: boolean; status: MinerStatus | null }>("/api/twitch/miner/switch", {
      method: "POST",
      body: JSON.stringify({ channelLogin }),
    }),
};
