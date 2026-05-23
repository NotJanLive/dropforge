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
    request<{ userCode: string; verificationUri: string; expiresAt: string; interval: number; deviceId: string }>(
      "/api/twitch/link/start",
      { method: "POST" }
    ),
  twitchLinkPoll: (deviceId: string) =>
    request<{ status: string }>("/api/twitch/link/poll", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
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
  switchChannel: (channelLogin: string) =>
    request<{ ok: boolean; status: MinerStatus | null }>("/api/twitch/miner/switch", {
      method: "POST",
      body: JSON.stringify({ channelLogin }),
    }),
};
