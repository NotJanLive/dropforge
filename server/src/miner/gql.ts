import { GQL_QUERIES, GQL_URL, GQL_RATE_LIMIT_MS } from "./constants.js";
import { gqlHeaders, type TwitchAuthSession } from "../twitch/auth.js";

type Json = Record<string, unknown>;

function persistedQuery(
  key: keyof typeof GQL_QUERIES,
  variables?: Json
): Json {
  const q = GQL_QUERIES[key];
  const body: Json = {
    operationName: q.operationName,
    extensions: {
      persistedQuery: { version: 1, sha256Hash: q.sha256Hash },
    },
  };
  if (variables) body.variables = variables;
  return body;
}

export class GqlClient {
  private lastRequest = 0;

  constructor(private auth: TwitchAuthSession) {}

  private async throttle() {
    const now = Date.now();
    const wait = GQL_RATE_LIMIT_MS - (now - this.lastRequest);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest = Date.now();
  }

  async request(body: Json | Json[]): Promise<Json[]> {
    await this.throttle();
    const res = await fetch(GQL_URL, {
      method: "POST",
      headers: gqlHeaders(this.auth),
      body: JSON.stringify(body),
    });
    if (res.status === 401) throw new Error("UNAUTHORIZED");
    if (!res.ok) throw new Error(`GQL request failed: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [data];
  }

  async single(key: keyof typeof GQL_QUERIES, variables?: Json): Promise<Json> {
    const [result] = await this.request(persistedQuery(key, variables));
    if (result.errors) {
      throw new Error(String((result.errors as Json[])[0]?.message ?? "GQL error"));
    }
    return result;
  }

  async sendWatchPayload(g64data: string): Promise<{ ok: boolean; status: number; errors: string[] }> {
    const [result] = await this.request({
      query: `mutation SendEvents($input: SendSpadeEventsInput!) {
        sendSpadeEvents(input: $input) { statusCode }
      }`,
      variables: {
        input: {
          data: g64data,
          repository: "twilight",
          encoding: "GZIP_B64",
        },
      },
    });
    const errors = Array.isArray(result.errors)
      ? (result.errors as Json[]).map((e) => String(e.message ?? "GQL error"))
      : [];
    const sendResult = (result.data as Json)?.sendSpadeEvents as Json | undefined;
    const status = Number(sendResult?.statusCode ?? 0);
    return { ok: status === 204, status, errors };
  }

  inventory() {
    return this.single("Inventory", { fetchRewardCampaigns: false });
  }

  campaigns() {
    return this.single("Campaigns", { fetchRewardCampaigns: false });
  }

  campaignDetails(viewerKey: string, dropId: string) {
    // TDM passes numeric user id as channelLogin
    return this.single("CampaignDetails", { channelLogin: viewerKey, dropID: dropId });
  }

  /** Batch multiple DropCampaignDetails queries in one HTTP request (TDM-style). */
  async campaignDetailsBatch(viewerKey: string, dropIds: string[]): Promise<Json[]> {
    if (dropIds.length === 0) return [];
    const body = dropIds.map((dropID) =>
      persistedQuery("CampaignDetails", { channelLogin: viewerKey, dropID })
    );
    return this.request(body);
  }

  currentDrop(channelId: string) {
    // TDM always passes empty channelLogin
    return this.single("CurrentDrop", { channelID: channelId, channelLogin: "" });
  }

  playbackAccessToken(login: string) {
    return this.single("PlaybackAccessToken", {
      isLive: true,
      isVod: false,
      login,
      platform: "web",
      playerType: "site",
      vodID: "",
    });
  }

  streamInfo(channelLogin: string) {
    return this.single("GetStreamInfo", { channel: channelLogin });
  }

  availableDrops(channelId: string) {
    return this.single("AvailableDrops", { channelID: channelId });
  }

  gameDirectory(slug: string, limit = 100) {
    return this.single("GameDirectory", {
      limit,
      slug,
      imageWidth: 50,
      includeCostreaming: true,
      options: {
        broadcasterLanguages: [],
        freeformTags: null,
        includeRestricted: ["SUB_ONLY_LIVE"],
        recommendationsContext: { platform: "web" },
        sort: "VIEWER_COUNT",
        systemFilters: ["DROPS_ENABLED"],
        tags: [],
        requestID: "dropforge",
      },
      sortTypeIsRecency: false,
    });
  }

  claimDrop(dropInstanceId: string) {
    return this.single("ClaimDrop", {
      input: { dropInstanceID: dropInstanceId },
    });
  }

  slugRedirect(name: string) {
    return this.single("SlugRedirect", { name });
  }
}

export { persistedQuery };
