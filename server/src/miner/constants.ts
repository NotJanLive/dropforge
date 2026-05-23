export type PriorityMode = "PRIORITY_ONLY" | "ENDING_SOONEST" | "LOW_AVBL_FIRST";

export type MinerState =
  | "IDLE"
  | "INVENTORY_FETCH"
  | "GAMES_UPDATE"
  | "CHANNELS_FETCH"
  | "CHANNELS_CLEANUP"
  | "CHANNEL_SWITCH"
  | "WATCHING"
  | "STOPPED"
  | "ERROR";

export const CLIENT_TYPES = {
  WEB: {
    clientId: "kimne78kx3ncx6brgo4mv6wki5h1ko",
    origin: "https://www.twitch.tv",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  },
  MOBILE_WEB: {
    clientId: "r8s4dac0uhzifbpu9sjdiwzctle17ff",
    origin: "https://m.twitch.tv",
    userAgent:
      "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.158 Mobile Safari/537.36",
  },
  ANDROID_APP: {
    clientId: "kd1unb4b3q4t58fwlpcbzcbnm76a8fp",
    origin: "https://www.twitch.tv",
    userAgent:
      "Dalvik/2.1.0 (Linux; U; Android 16; SM-S911B Build/TP1A.220624.014) tv.twitch.android.app/25.3.0/2503006",
  },
  SMARTBOX: {
    clientId: "ue6666qo983tsx6so1t0vnawi233wa",
    origin: "https://android.tv.twitch.tv",
    userAgent:
      "Mozilla/5.0 (Linux; Android 7.1; Smart Box C1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  },
} as const;

export type ClientTypeName = keyof typeof CLIENT_TYPES;

export function getClientType(): (typeof CLIENT_TYPES)[ClientTypeName] {
  const name = (process.env.TWITCH_CLIENT_TYPE ?? "WEB") as ClientTypeName;
  return CLIENT_TYPES[name] ?? CLIENT_TYPES.WEB;
}

export const GQL_URL = "https://gql.twitch.tv/gql";
export const PUBSUB_URL = "wss://pubsub-edge.twitch.tv/v1";

export const MAX_WEBSOCKETS = 8;
export const WS_TOPICS_LIMIT = 50;
export const BASE_TOPICS = 2;
export const TOPICS_PER_CHANNEL = 2;
export const MAX_TOPICS = MAX_WEBSOCKETS * WS_TOPICS_LIMIT - BASE_TOPICS;
export const MAX_CHANNELS = Math.floor(MAX_TOPICS / TOPICS_PER_CHANNEL);

export const PING_INTERVAL_MS = 3 * 60 * 1000;
export const PING_TIMEOUT_MS = 10 * 1000;
export const ONLINE_DELAY_MS = 120 * 1000;
export const WATCH_INTERVAL_MS = 59 * 1000;
export const GQL_RATE_LIMIT_MS = 200;
/** Campaign details per GQL batch request (matches TwitchDropsMiner). */
export const CAMPAIGN_DETAILS_CHUNK_SIZE = 20;
/** Fallback channel online check when PubSub misses an event (not for drop progress). */
export const CHANNEL_REFRESH_MS = 5 * 60 * 1000;
/** Full Twitch inventory reload interval (TwitchDropsMiner maintenance task). */
export const INVENTORY_MAINTENANCE_MS = 60 * 60 * 1000;
export const LOOP_INTERVAL_MS = 15 * 1000;

export const WEBSOCKET_TOPICS = {
  User: {
    Presence: "presence",
    Drops: "user-drop-events",
    Notifications: "onsite-notifications",
    CommunityPoints: "community-points-user-v1",
  },
  Channel: {
    Drops: "channel-drop-events",
    StreamState: "video-playback-by-id",
    StreamUpdate: "broadcast-settings-update",
    CommunityPoints: "community-points-channel-v1",
  },
} as const;

export const GQL_QUERIES = {
  GetStreamInfo: {
    operationName: "VideoPlayerStreamInfoOverlayChannel",
    sha256Hash: "198492e0857f6aedead9665c81c5a06d67b25b58034649687124083ff288597d",
  },
  ClaimDrop: {
    operationName: "DropsPage_ClaimDropRewards",
    sha256Hash: "a455deea71bdc9015b78eb49f4acfbce8baa7ccbedd28e549bb025bd0f751930",
  },
  Inventory: {
    operationName: "Inventory",
    sha256Hash: "d86775d0ef16a63a33ad52e80eaff963b2d5b72fada7c991504a57496e1d8e4b",
  },
  CurrentDrop: {
    operationName: "DropCurrentSessionContext",
    sha256Hash: "4d06b702d25d652afb9ef835d2a550031f1cf762b193523a92166f40ea3d142b",
  },
  PlaybackAccessToken: {
    operationName: "PlaybackAccessToken",
    sha256Hash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9",
  },
  Campaigns: {
    operationName: "ViewerDropsDashboard",
    sha256Hash: "5a4da2ab3d5b47c9f9ce864e727b2cb346af1e3ea8b897fe8f704a97ff017619",
  },
  CampaignDetails: {
    operationName: "DropCampaignDetails",
    sha256Hash: "039277bf98f3130929262cc7c6efd9c141ca3749cb6dca442fc8ead9a53f77c1",
  },
  AvailableDrops: {
    operationName: "DropsHighlightService_AvailableDrops",
    sha256Hash: "782dad0f032942260171d2d80a654f88bdd0c5a9dddc392e9bc92218a0f42d20",
  },
  GameDirectory: {
    operationName: "DirectoryPage_Game",
    sha256Hash: "cb5dc816e139dcb8a118f14b4b677d59abc224a4b016c4bc2bb00a47fe0ddec4",
  },
  SlugRedirect: {
    operationName: "DirectoryGameRedirect",
    sha256Hash: "1f0300090caceec51f33c5e20647aceff9017f740f223c3c532ba6fa59b6b6cc",
  },
} as const;

export interface DropProgress {
  dropId: string;
  dropName: string;
  campaignId: string;
  campaignName: string;
  gameName: string;
  imageUrl: string;
  gameImageUrl: string;
  currentMinutes: number;
  requiredMinutes: number;
  isComplete: boolean;
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
  /** Watch-time remaining in seconds (TDM-style, synced to last watch tick). */
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
  isClaimed: boolean;
}

export interface ChannelInfo {
  id: string;
  login: string;
  displayName: string;
  gameName: string;
  gameSlug: string;
  gameId?: string;
  online: boolean;
  viewers: number;
  campaignIds: string[];
  aclPreferred: boolean;
  dropsEnabled?: boolean;
}

export interface CampaignInfo {
  id: string;
  name: string;
  gameName: string;
  gameSlug: string;
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
    /** Watch progress finished (may still need claim). */
    isComplete: boolean;
    /** Reward claimed on Twitch. */
    isClaimed: boolean;
    canClaim: boolean;
    claimId?: string;
    preconditionDropIds: string[];
    endsAt: string;
  }>;
  channels: ChannelInfo[];
}

export interface MinerLogEntry {
  time: string;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

export const MAX_MINER_LOGS = 150;

export interface CampaignSummary {
  id: string;
  name: string;
  gameName: string;
  gameSlug: string;
  gameImageUrl: string;
  status: string;
  linked: boolean;
  startsAt: string;
  endsAt: string;
  dropCount: number;
}

export interface MiningCampaignOption {
  id: string;
  name: string;
  gameName: string;
  gameImageUrl: string;
}

export interface MinerStatus {
  state: MinerState;
  message: string;
  watchingChannel: string | null;
  watchingGame: string | null;
  currentDrop: DropProgress | null;
  activeMining: ActiveMiningView | null;
  campaigns: CampaignInfo[];
  channels: ChannelInfo[];
  logs: MinerLogEntry[];
  websocketConnections: number;
  lastWatchAt: string | null;
  updatedAt: string;
  /** User-pinned campaign until finished; null = automatic priority. */
  activeCampaignId: string | null;
  /** Campaign the miner is currently focused on (pinned or top priority). */
  focusedCampaignId: string | null;
  focusedCampaignName: string | null;
  focusedGameName: string | null;
  miningCampaignOptions: MiningCampaignOption[];
}

export function topicStr(category: "User" | "Channel", name: string, id: string | number): string {
  const base = WEBSOCKET_TOPICS[category][name as keyof (typeof WEBSOCKET_TOPICS)[typeof category]];
  return `${base}.${id}`;
}
