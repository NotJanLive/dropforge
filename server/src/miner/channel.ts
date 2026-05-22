import zlib from "zlib";
import { promisify } from "util";
import type { TwitchAuthSession } from "../twitch/auth.js";
import { gqlHeaders } from "../twitch/auth.js";
import { getClientType } from "./constants.js";
import { GqlClient } from "./gql.js";
import type { ChannelInfo, CampaignInfo } from "./constants.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function campaignMatchesDropEntry(entry: Record<string, unknown>, campaign: CampaignInfo): boolean {
  if (campaign.id) {
    const dropCampaign = asRecord(entry.dropCampaign);
    const id = String(entry.id ?? dropCampaign.id ?? "");
    if (id && id === campaign.id) return true;
  }

  const game = asRecord(entry.game ?? asRecord(entry.dropCampaign).game);
  const gn = String(game.displayName ?? game.name ?? "").toLowerCase();
  const gs = String(game.slug ?? "").toLowerCase();
  const cn = campaign.gameName.toLowerCase();
  const cs = campaign.gameSlug.toLowerCase();

  if (cn && gn && cn === gn) return true;
  if (cs && gs && cs === gs) return true;
  if (cn && gs && cn === gs) return true;
  if (cs && gn && cs === gn) return true;

  return false;
}

/** True when Twitch reports this channel has drops for one of the focused campaigns. */
export async function channelHasCampaignDrops(
  auth: TwitchAuthSession,
  channelId: string,
  campaigns: CampaignInfo[]
): Promise<boolean> {
  if (campaigns.length === 0) return false;
  try {
    const gql = new GqlClient(auth);
    const result = await gql.availableDrops(channelId);
    const channel = asRecord((result.data as Record<string, unknown>)?.channel);
    const list = asArray<Record<string, unknown>>(channel.viewerDropCampaigns);
    return list.some((entry) => campaigns.some((c) => campaignMatchesDropEntry(entry, c)));
  } catch {
    return false;
  }
}

const gzip = promisify(zlib.gzip);

function jsonMinify(data: unknown): string {
  return JSON.stringify(data);
}

function twitchStreamHeaders(auth: TwitchAuthSession): Record<string, string> {
  const client = getClientType();
  return {
    ...gqlHeaders(auth),
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: `${client.origin}/`,
    Origin: client.origin,
  };
}

function resolvePlaylistUrl(baseUrl: string, line: string): string {
  if (line.startsWith("http://") || line.startsWith("https://")) return line;
  return new URL(line, baseUrl).href;
}

/** Parse m3u8 and return the last media segment/chunk URL (follows quality playlists). */
async function resolveChunkHeadUrl(
  playlistUrl: string,
  headers: Record<string, string>,
  depth = 0
): Promise<string | null> {
  if (depth > 3) return null;

  const res = await fetch(playlistUrl, { headers, redirect: "follow" });
  if (!res.ok) return null;

  const text = await res.text();
  if (text.trimStart().startsWith("{")) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (json.error) return null;
    } catch {
      /* not json */
    }
  }

  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  if (lines.length === 0) return null;

  let last = lines[lines.length - 1];
  if (last === "#EXT-X-ENDLIST" && lines.length > 1) {
    last = lines[lines.length - 2];
  }

  const resolved = resolvePlaylistUrl(playlistUrl, last);
  if (resolved.includes(".m3u8")) {
    return resolveChunkHeadUrl(resolved, headers, depth + 1);
  }

  return resolved;
}

export function encodeSpadePayload(payload: Record<string, unknown>): Promise<string> {
  return gzip(Buffer.from(jsonMinify([payload]), "utf8")).then((buf) => buf.toString("base64"));
}

/** Match DevilXD/TwitchDropsMiner channel.py Stream._gql_payload properties. */
export async function buildMinuteWatchedPayload(
  auth: TwitchAuthSession,
  channel: ChannelInfo,
  broadcastId: string
): Promise<string> {
  return encodeSpadePayload({
    event: "minute-watched",
    properties: {
      broadcast_id: String(broadcastId),
      channel_id: String(channel.id),
      channel: channel.login,
      client_time: new Date().toISOString(),
      game: channel.gameName ?? "",
      game_id: channel.gameId ?? "",
      hidden: false,
      is_live: true,
      live: true,
      logged_in: true,
      minutes_logged: 1,
      muted: false,
      user_id: auth.userId,
    },
  });
}

export interface WatchResult {
  ok: boolean;
  status: number;
  errors: string[];
}

export async function sendWatch(
  auth: TwitchAuthSession,
  channel: ChannelInfo,
  broadcastId: string
): Promise<WatchResult> {
  if (!channel.id || !/^\d+$/.test(channel.id)) {
    return { ok: false, status: 0, errors: ["invalid channel id"] };
  }
  if (!broadcastId) {
    return { ok: false, status: 0, errors: ["missing broadcast id"] };
  }

  const gql = new GqlClient(auth);
  const payload = await buildMinuteWatchedPayload(auth, channel, broadcastId);
  return gql.sendWatchPayload(payload);
}

/**
 * TDM README: "pretends to watch by fetching stream metadata" — HLS playlist + chunk HEAD.
 * See DevilXD/TwitchDropsMiner channel.py Stream.get_stream_url + _send_watch_playlist.
 */
export async function sendWatchStream(
  auth: TwitchAuthSession,
  channelLogin: string
): Promise<{ ok: boolean; detail: string }> {
  try {
    const gql = new GqlClient(auth);
    const tokenResult = await gql.playbackAccessToken(channelLogin);
    const tokenData = (tokenResult.data as Record<string, unknown>)?.streamPlaybackAccessToken as
      | Record<string, unknown>
      | undefined;
    if (!tokenData?.value || !tokenData?.signature) {
      return { ok: false, detail: "no playback token" };
    }

    const headers = twitchStreamHeaders(auth);
    const token = encodeURIComponent(String(tokenData.value));
    const sig = encodeURIComponent(String(tokenData.signature));
    const masterUrl = `https://usher.ttvnw.net/api/channel/hls/${channelLogin}.m3u8?sig=${sig}&token=${token}`;

    const chunkUrl = await resolveChunkHeadUrl(masterUrl, { ...headers, Connection: "close" });
    if (!chunkUrl) {
      return { ok: false, detail: "no chunk url in playlist" };
    }

    const headRes = await fetch(chunkUrl, {
      method: "HEAD",
      headers: { ...headers, Connection: "close" },
    });
    return headRes.ok
      ? { ok: true, detail: "chunk head ok" }
      : { ok: false, detail: `chunk head ${headRes.status}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "stream watch failed";
    return { ok: false, detail: msg };
  }
}

/** Full watch tick: TDM uses GQL spade; stream HEAD is a best-effort extra. */
export async function performWatchTick(
  auth: TwitchAuthSession,
  channel: ChannelInfo,
  broadcastId: string
): Promise<{ spadeOk: boolean; detail: string }> {
  const spade = await sendWatch(auth, channel, broadcastId);
  void sendWatchStream(auth, channel.login);
  const detail = spade.ok
    ? `spade=${spade.status}`
    : `spade failed (${spade.status}: ${spade.errors.join("; ") || "unknown"})`;
  return { spadeOk: spade.ok, detail };
}

export async function fetchStreamInfo(
  auth: TwitchAuthSession,
  login: string
): Promise<{
  online: boolean;
  broadcastId: string | null;
  channelId: string | null;
  viewers: number;
  gameName: string;
  gameSlug: string;
  gameId: string;
}> {
  const gql = new GqlClient(auth);
  const result = await gql.streamInfo(login);
  const user = (result.data as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
  const stream = user?.stream as Record<string, unknown> | undefined;
  const channelId = user?.id ? String(user.id) : null;
  if (!stream) {
    return {
      online: false,
      broadcastId: null,
      channelId,
      viewers: 0,
      gameName: "",
      gameSlug: "",
      gameId: "",
    };
  }
  const broadcastSettings = user?.broadcastSettings as Record<string, unknown> | undefined;
  const game = (broadcastSettings?.game ?? stream.game) as Record<string, unknown> | undefined;
  return {
    online: true,
    broadcastId: String(stream.id ?? ""),
    channelId,
    viewers: Number(stream.viewersCount ?? 0),
    gameName: String(game?.displayName ?? game?.name ?? ""),
    gameSlug: String(game?.slug ?? ""),
    gameId: String(game?.id ?? ""),
  };
}

export async function channelMiningDropIds(
  auth: TwitchAuthSession,
  channelId: string,
  miningCampaignIds: string[]
): Promise<string[]> {
  if (miningCampaignIds.length === 0) return [];
  try {
    const gql = new GqlClient(auth);
    const result = await gql.availableDrops(channelId);
    const channel = (result.data as Record<string, unknown>)?.channel as Record<string, unknown> | undefined;
    const list = (channel?.viewerDropCampaigns as unknown[]) ?? [];
    const miningSet = new Set(miningCampaignIds);
    return list
      .map((c) => String((c as Record<string, unknown>).id ?? ""))
      .filter((id) => id && miningSet.has(id));
  } catch {
    return [];
  }
}

export async function channelHasMiningDrops(
  auth: TwitchAuthSession,
  channelId: string,
  miningCampaignIds: string[]
): Promise<boolean> {
  return channelHasCampaignDrops(
    auth,
    channelId,
    miningCampaignIds.map((id) => ({
      id,
      name: "",
      gameName: "",
      gameSlug: "",
      gameImageUrl: "",
      status: "ACTIVE",
      linked: true,
      startsAt: "",
      endsAt: "",
      drops: [],
      channels: [],
    }))
  );
}

export async function fetchAvailableDrops(auth: TwitchAuthSession, channelId: string): Promise<boolean> {
  try {
    const gql = new GqlClient(auth);
    const result = await gql.availableDrops(channelId);
    const drops = (result.data as Record<string, unknown>)?.channel as Record<string, unknown> | undefined;
    const list = drops?.viewerDropCampaigns as unknown[] | undefined;
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
}
