import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, AlertCircle, CheckCircle2, Circle, Radio, RefreshCw, Terminal, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { api, type CampaignDropView, type ChannelInfo, type MinerLogEntry, type MinerStatus } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMinerWebSocket } from "@/hooks/useMinerWebSocket";
import {
  formatWatchRemaining,
  useWatchRemainingFromMinutes,
  useWatchRemainingSeconds,
} from "@/lib/miningDisplay";
import { TwitchImage } from "@/components/TwitchImage";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { cn } from "@/lib/utils";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";

export function OverviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [twitchLinked, setTwitchLinked] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [selectingCampaign, setSelectingCampaign] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const wsStatus = useMinerWebSocket(
    user?.role === "user" && twitchLinked !== false ? user.id : null
  );

  useEffect(() => {
    if (user?.role !== "user") return;
    const load = () => {
      api.twitchStatus().then((s) => setTwitchLinked(s.linked)).catch(() => setTwitchLinked(false));
      api.minerStatus().then((r) => {
        if (r.status) setStatus(r.status);
        if (r.twitchLinked === false) setTwitchLinked(false);
      }).catch(() => undefined);
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [user]);

  const live = twitchLinked === false ? status : wsStatus ?? status;
  const mining = live?.activeMining;

  const dropRemainingSec = useWatchRemainingSeconds(
    mining?.dropCurrentMinutes ?? 0,
    mining?.dropRequiredMinutes ?? 0,
    live?.lastWatchAt
  );
  const campaignRemainingSec = useWatchRemainingFromMinutes(
    mining?.campaignRemainingMinutes ?? 0,
    live?.lastWatchAt
  );

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = 0;
  }, [live?.logs?.length]);

  const switchTo = async (login: string) => {
    setSwitching(login);
    try {
      const result = await api.switchChannel(login);
      if (result.status) setStatus(result.status);
    } finally {
      setSwitching(null);
    }
  };

  const reload = async () => {
    if (twitchLinked !== true) return;
    const result = await api.minerReload();
    if (result.status) setStatus(result.status);
  };

  const selectCampaign = async (campaignId: string | null) => {
    setSelectingCampaign(true);
    try {
      const result = await api.selectCampaign(campaignId);
      if (result.status) setStatus(result.status);
    } finally {
      setSelectingCampaign(false);
    }
  };

  if (user?.role === "admin") {
    return (
      <DashboardPage>
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="text-muted-foreground">Manage users and global miner settings from the sidebar.</p>
        </div>
      </DashboardPage>
    );
  }

  const channels = [...(live?.channels ?? [])].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const aDrops = a.dropsEnabled ? 1 : 0;
    const bDrops = b.dropsEnabled ? 1 : 0;
    if (aDrops !== bDrops) return bDrops - aDrops;
    return b.viewers - a.viewers;
  });

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0 space-y-4">
        {twitchLinked === false && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm font-semibold leading-snug">Twitch not linked</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      Link your Twitch account to enable the miner and load drop campaigns.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  className="w-full shrink-0 sm:w-auto"
                  onClick={() => navigate("/dashboard/twitch-link")}
                >
                  Link Twitch
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold sm:text-2xl">Miner</h1>
            <p className="text-sm break-words text-muted-foreground sm:text-base">
              {twitchLinked === false
                ? "Twitch account required — link your account to start mining"
                : live?.watchingChannel
                  ? `Watching: ${live.watchingChannel}${live.watchingGame ? ` · ${live.watchingGame}` : ""}`
                  : live?.message ?? (twitchLinked ? "Starting miner…" : "Checking Twitch link…")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 min-h-10"
            onClick={reload}
            disabled={twitchLinked !== true}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reload
          </Button>
        </div>
      </div>

      <DashboardScrollArea className="space-y-4 pb-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
        <div className="grid shrink-0 gap-3 sm:grid-cols-2 sm:gap-4 md:grid-cols-3">
          <StatCard icon={Activity} label="Status" value={live?.state ?? "—"} />
          <StatCard icon={Radio} label="Watching" value={live?.watchingChannel ?? "None"} />
          <StatCard
            icon={Timer}
            label="Last watch tick"
            value={live?.lastWatchAt ? new Date(live.lastWatchAt).toLocaleTimeString() : "—"}
          />
        </div>

        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="order-1 flex min-w-0 flex-col gap-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
          <Card
            className={cn(
              "flex flex-col border-primary/25",
              mining && "lg:min-h-0 lg:flex-1 lg:overflow-hidden",
              live?.state === "IDLE" && "border-border/60"
            )}
          >
            <CardHeader className="shrink-0 space-y-3 pb-3">
              <CardTitle>
                {twitchLinked === false
                  ? "Miner status"
                  : live?.state === "IDLE"
                    ? "Miner status"
                    : "Campaign progress"}
              </CardTitle>
              {(live?.miningCampaignOptions?.length ?? 0) > 0 && (
                <div className="flex w-full justify-center">
                  <CampaignSelector
                    className="w-full max-w-md"
                    options={live?.miningCampaignOptions ?? []}
                    activeCampaignId={live?.activeCampaignId ?? null}
                    disabled={selectingCampaign}
                    onSelect={selectCampaign}
                  />
                </div>
              )}
            </CardHeader>
            <CardContent
              className={cn(
                "flex flex-col gap-4 pt-0",
                mining && "lg:min-h-0 lg:flex-1 lg:overflow-hidden"
              )}
            >
            {twitchLinked === false ? (
              <div className="py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No campaign data until Twitch is connected.
                </p>
              </div>
            ) : live?.state === "IDLE" ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-xl font-medium">Idle</p>
                <p className="text-muted-foreground text-sm max-w-md mx-auto">{live.message}</p>
                <p className="text-xs text-muted-foreground max-w-lg mx-auto">
                  New campaigns are checked every hour and when Twitch sends a drop notification.
                  Use <strong>Reload</strong> to fetch immediately.
                </p>
              </div>
            ) : mining ? (
              <>
                <div className="shrink-0 grid gap-4 xl:grid-cols-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <TwitchImage
                      src={resolveGameImageUrl({ gameImageUrl: mining.gameImageUrl, gameName: mining.gameName })}
                      fallbackSrc={resolveGameImageUrl({ gameName: mining.gameName })}
                      alt={mining.gameName}
                      className="h-16 w-11 rounded object-cover shrink-0 bg-muted"
                      fallbackClassName="h-16 w-11 rounded bg-muted shrink-0"
                    />
                    <div className="space-y-2 min-w-0 flex-1">
                      <CompactProgressRow label="Game" value={mining.gameName} />
                      <CompactProgressRow label="Campaign" value={mining.campaignName} />
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="text-muted-foreground shrink-0">Progress</span>
                          <span className="font-medium tabular-nums truncate">
                            {mining.campaignProgress.toFixed(1)}% ({mining.campaignClaimed}/{mining.campaignTotal})
                          </span>
                        </div>
                        <Progress value={mining.campaignProgress} className="h-2" />
                        {mining.campaignRemainingMinutes > 0 && (
                          <p className="text-sm text-primary font-mono tabular-nums">
                            {formatWatchRemaining(campaignRemainingSec)} remaining
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 min-w-0">
                    <TwitchImage
                      src={mining.dropImageUrl || resolveGameImageUrl({ gameImageUrl: mining.gameImageUrl, gameName: mining.gameName })}
                      fallbackSrc={resolveGameImageUrl({ gameImageUrl: mining.gameImageUrl, gameName: mining.gameName })}
                      alt={mining.dropName}
                      className="h-16 w-16 rounded object-cover shrink-0 bg-muted"
                      fallbackClassName="h-16 w-16 rounded bg-muted shrink-0"
                    />
                    <div className="space-y-2 min-w-0 flex-1">
                      <CompactProgressRow label="Mining now" value={mining.dropName} />
                      <div className="space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="text-muted-foreground shrink-0">Progress</span>
                          <span className="font-medium tabular-nums">{mining.dropProgress.toFixed(1)}%</span>
                        </div>
                        <Progress value={mining.dropProgress} className="h-2" />
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {mining.dropCurrentMinutes}/{mining.dropRequiredMinutes} minutes watched
                        </p>
                        {mining.dropRemainingMinutes > 0 && (
                          <p className="text-sm text-primary font-mono tabular-nums">
                            {formatWatchRemaining(dropRemainingSec)} remaining
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 border-t border-border/60 pt-3 sm:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-rows-1 lg:overflow-hidden">
                  <DropListColumn
                    title="Claimed"
                    emptyText="No drops claimed yet"
                    drops={mining.claimedDrops ?? []}
                    variant="claimed"
                    gameImageUrl={mining.gameImageUrl}
                    gameName={mining.gameName}
                  />
                  <DropListColumn
                    title="Up next"
                    emptyText="No more drops in this campaign"
                    drops={mining.upcomingDrops ?? []}
                    variant="upcoming"
                    gameImageUrl={mining.gameImageUrl}
                    gameName={mining.gameName}
                  />
                </div>
              </>
            ) : (
              <div className="shrink-0 text-sm text-muted-foreground space-y-2">
                <p>No active drop session yet.</p>
                <p>
                  Watch a live channel with drops enabled and press <strong>Reload</strong> if campaigns are empty.
                </p>
              </div>
            )}
          </CardContent>
          </Card>

          <Card className="shrink-0">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Terminal className="h-4 w-4" />
                Output
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div
                ref={logRef}
                className="h-48 overflow-y-auto rounded-lg border border-border/60 bg-black/40 p-3 font-mono text-xs space-y-1 lg:h-56"
              >
                {(live?.logs ?? []).map((entry, i) => (
                  <LogLine key={`${entry.time}-${i}`} entry={entry} />
                ))}
                {(live?.logs ?? []).length === 0 && (
                  <p className="text-muted-foreground">Waiting for miner events...</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="order-2 relative min-h-0">
          <ChannelsPanel
            className="lg:absolute lg:inset-0 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden"
            channels={channels}
            watchingChannel={live?.watchingChannel ?? null}
            switching={switching}
            focusedGameName={live?.focusedGameName ?? null}
            focusedCampaignName={live?.focusedCampaignName ?? null}
            onSwitch={switchTo}
          />
        </div>
        </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}

function CampaignSelector({
  options,
  activeCampaignId,
  disabled,
  onSelect,
  className,
}: {
  options: Array<{ id: string; name: string; gameName: string; gameImageUrl: string }>;
  activeCampaignId: string | null;
  focusedCampaignId?: string | null;
  disabled: boolean;
  onSelect: (campaignId: string | null) => void;
  className?: string;
}) {
  const value = activeCampaignId ?? "__auto__";

  return (
    <div className={cn("space-y-1.5 w-full text-center", className)}>
      <Label htmlFor="campaign-select" className="text-xs text-muted-foreground">
        Mining campaign
        {!activeCampaignId && " · automatic priority"}
        {activeCampaignId && " · pinned until complete"}
      </Label>
      <select
        id="campaign-select"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          onSelect(next === "__auto__" ? null : next);
        }}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm",
          "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <option value="__auto__">Automatic (priority)</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.gameName} — {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChannelsPanel({
  className,
  channels,
  watchingChannel,
  switching,
  focusedGameName,
  focusedCampaignName,
  onSwitch,
}: {
  className?: string;
  channels: ChannelInfo[];
  watchingChannel: string | null;
  switching: string | null;
  focusedGameName: string | null;
  focusedCampaignName: string | null;
  onSwitch: (login: string) => void;
}) {
  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader className="shrink-0 pb-3">
        <CardTitle className="text-base">Channels</CardTitle>
        <CardDescription>
          {focusedGameName
            ? `${focusedGameName}${focusedCampaignName ? ` · ${focusedCampaignName}` : ""}`
            : "Manual switch · drops-enabled first"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pt-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
        {channels.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">No channels loaded yet.</p>
        )}
        {channels.map((ch) => (
          <div
            key={`${ch.id}-${ch.login}`}
            className={cn(
              "rounded-lg border p-3 space-y-2",
              watchingChannel === ch.login ? "border-primary/50 bg-primary/5" : "border-border/60"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{ch.displayName || ch.login}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {ch.gameName || "—"}
                  {ch.online ? ` · ${ch.viewers.toLocaleString()} viewers` : " · Offline"}
                  {" · Drops"}
                </p>
              </div>
              <span
                className={cn(
                  "h-2 w-2 rounded-full shrink-0 mt-1.5",
                  ch.online ? "bg-emerald-400" : "bg-muted-foreground"
                )}
              />
            </div>
            <Button
              size="sm"
              variant={watchingChannel === ch.login ? "default" : "outline"}
              className="w-full"
              disabled={switching === ch.login}
              onClick={() => onSwitch(ch.login)}
            >
              {switching === ch.login
                ? "Switching..."
                : watchingChannel === ch.login
                  ? "Watching"
                  : "Switch"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DropListColumn({
  title,
  emptyText,
  drops,
  variant,
  gameImageUrl,
  gameName,
}: {
  title: string;
  emptyText: string;
  drops: CampaignDropView[];
  variant: "claimed" | "upcoming";
  gameImageUrl?: string;
  gameName?: string;
}) {
  const gameImg = resolveGameImageUrl({ gameImageUrl, gameName });
  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2.5 lg:h-full lg:overflow-hidden">
      <p className="shrink-0 text-sm font-medium text-muted-foreground">{title}</p>
      <div className="space-y-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
        {drops.length === 0 && <p className="text-xs text-muted-foreground">{emptyText}</p>}
        {drops.map((drop) => (
          <div
            key={drop.id}
            className={cn(
              "flex items-center gap-2 rounded-lg border p-2",
              variant === "claimed" ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/60"
            )}
          >
            {variant === "claimed" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <TwitchImage
              src={drop.imageUrl || gameImg}
              fallbackSrc={gameImg}
              alt={drop.name}
              className="h-10 w-10 rounded object-cover shrink-0 bg-muted"
              fallbackClassName="h-10 w-10 rounded bg-muted shrink-0"
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">{drop.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {variant === "claimed"
                  ? `${drop.requiredMinutes} min`
                  : `${drop.requiredMinutes} min required`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompactProgressRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm truncate leading-snug">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value || "—"}</span>
    </p>
  );
}

function ProgressRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium truncate">{value || "—"}</p>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex flex-col justify-center gap-0.5">
            <p className="text-xs leading-normal text-muted-foreground">{label}</p>
            <p className="truncate font-medium leading-snug">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function LogLine({ entry }: { entry: MinerLogEntry }) {
  const color =
    entry.level === "error"
      ? "text-red-400"
      : entry.level === "warn"
        ? "text-amber-400"
        : entry.level === "success"
          ? "text-emerald-400"
          : "text-muted-foreground";

  return (
    <div className={color}>
      <span className="text-muted-foreground/70">{new Date(entry.time).toLocaleTimeString()} </span>
      {entry.message}
    </div>
  );
}
