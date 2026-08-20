import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  Circle,
  Clock3,
  Gift,
  Moon,
  Radio,
  RefreshCw,
  Sparkles,
  Timer,
  Tv,
  Users,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { api, type ActiveMiningView, type CampaignDropView, type ChannelInfo, type MinerStatus } from "@/lib/api";
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
import { AdminMinersOverview } from "@/components/AdminMinersOverview";
import { PageHeader } from "@/components/PageHeader";
import { StatTile } from "@/components/StatTile";
import { EmptyState } from "@/components/EmptyState";
import { LogConsole } from "@/components/LogConsole";
import { StatePill, StatusDot } from "@/components/MinerState";

export function OverviewPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [twitchLinked, setTwitchLinked] = useState<boolean | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const [selectingCampaign, setSelectingCampaign] = useState(false);
  const [reloading, setReloading] = useState(false);
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
    setReloading(true);
    try {
      const result = await api.minerReload();
      if (result.status) setStatus(result.status);
    } finally {
      setReloading(false);
    }
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
      <DashboardPage className="gap-4">
        <AdminMinersOverview />
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

  const headline =
    twitchLinked === false
      ? "Twitch account required — link your account to start mining."
      : live?.watchingChannel
        ? `Watching ${live.watchingChannel}${live.watchingGame ? ` · ${live.watchingGame}` : ""}`
        : live?.message ?? (twitchLinked ? "Starting miner…" : "Checking Twitch link…");

  return (
    <DashboardPage className="gap-4 lg:gap-3">
      <div className="shrink-0 space-y-3.5 lg:space-y-3">
        {twitchLinked === false && (
          <Alert
            tone="warning"
            title="Twitch not linked"
            action={
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => navigate("/dashboard/twitch-link")}
              >
                Link Twitch
              </Button>
            }
          >
            Link your Twitch account to enable the miner and load drop campaigns.
          </Alert>
        )}

        {(live?.unclaimedDrops ?? 0) > 0 && (
          <Alert
            tone="warning"
            icon={Gift}
            title={
              live!.unclaimedDrops === 1
                ? "1 drop could not be claimed"
                : `${live!.unclaimedDrops} drops could not be claimed`
            }
          >
            Link your game account on Twitch to allow automatic claiming.
          </Alert>
        )}

        <PageHeader
          eyebrow={
            <>
              <StatusDot tone={live?.state === "WATCHING" ? "live" : "neutral"} />
              Miner
            </>
          }
          title="Mining dashboard"
          description={headline}
          actions={
            <>
              <StatePill state={live?.state ?? "—"} size="md" className="max-sm:order-2" />
              <Button
                variant="outline"
                size="sm"
                className="max-sm:flex-1"
                onClick={reload}
                loading={reloading}
                disabled={twitchLinked !== true}
              >
                {!reloading && <RefreshCw className="h-4 w-4" />}
                Reload
              </Button>
            </>
          }
        />
      </div>

      <DashboardScrollArea className="space-y-4 pb-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-3 lg:overflow-hidden">
        <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile
            className="col-span-2 sm:col-span-1"
            icon={Activity}
            label="Status"
            value={live?.state ?? "—"}
            hint={live?.message}
            tone={live?.state === "WATCHING" ? "success" : live?.state === "ERROR" ? "danger" : "brand"}
          />
          <StatTile
            icon={Radio}
            label="Watching"
            value={live?.watchingChannel ?? "None"}
            hint={live?.watchingGame ?? "No channel selected"}
            tone={live?.watchingChannel ? "success" : "neutral"}
          />
          <StatTile
            icon={Timer}
            label="Last watch tick"
            value={live?.lastWatchAt ? new Date(live.lastWatchAt).toLocaleTimeString() : "—"}
            hint={`${channels.filter((c) => c.online).length} channels live`}
            tone="neutral"
          />
        </div>

        <div className="grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-3">
          <div className="order-1 flex min-w-0 flex-col gap-4 lg:min-h-0 lg:gap-3 lg:overflow-y-auto lg:pr-1 lg:dashboard-scroll">
            <Card
              className={cn("flex shrink-0 flex-col overflow-hidden", mining && "lg:border-primary/20")}
            >
              <CardHeader className="shrink-0 gap-3 border-b border-white/[0.05] bg-white/[0.015] pb-4 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:p-3.5">
                <div className="flex flex-wrap items-center gap-3 lg:min-w-0 lg:flex-1">
                  <CardTitle className="flex flex-1 items-center gap-2 lg:flex-none">
                    <Sparkles className="h-4 w-4 text-primary" />
                    {twitchLinked === false || live?.state === "IDLE"
                      ? "Miner status"
                      : "Now mining"}
                  </CardTitle>
                  {mining && (
                    <Badge variant="primary" size="md" className="tabular-nums">
                      {mining.campaignClaimed}/{mining.campaignTotal} drops claimed
                    </Badge>
                  )}
                </div>

                {(live?.miningCampaignOptions?.length ?? 0) > 0 && (
                  <div className="flex flex-col gap-1.5 lg:w-[19rem] lg:shrink-0">
                    <label
                      htmlFor="campaign-select"
                      className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground lg:sr-only"
                    >
                      Campaign focus
                    </label>
                    <Select
                      id="campaign-select"
                      className="h-10 lg:h-9"
                      value={live?.activeCampaignId ?? "__auto__"}
                      disabled={selectingCampaign}
                      onChange={(e) => {
                        const next = e.target.value;
                        selectCampaign(next === "__auto__" ? null : next);
                      }}
                    >
                      <option value="__auto__">Automatic (priority)</option>
                      {(live?.miningCampaignOptions ?? []).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.gameName} — {c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
              </CardHeader>

              <CardContent className="flex flex-col gap-4 p-4 pt-4 sm:p-5 sm:pt-5 lg:gap-3 lg:p-4 lg:pt-4">
                {twitchLinked === false ? (
                  <EmptyState
                    icon={Tv}
                    title="No campaign data"
                    description="Connect your Twitch account to load drop campaigns and start mining."
                  />
                ) : live?.state === "IDLE" ? (
                  <EmptyState
                    icon={Moon}
                    title="Miner is idle"
                    description={
                      <>
                        <span className="block">{live.message}</span>
                        <span className="mt-2 block text-xs text-muted-foreground/80">
                          New campaigns are checked every hour and when Twitch sends a drop
                          notification. Use <strong className="text-foreground">Reload</strong> to
                          fetch immediately.
                        </span>
                      </>
                    }
                  />
                ) : mining ? (
                  <MiningPanel
                    mining={mining}
                    campaignRemainingSec={campaignRemainingSec}
                    dropRemainingSec={dropRemainingSec}
                  />
                ) : (
                  <EmptyState
                    icon={Clock3}
                    title="No active drop session yet"
                    description="Watch a live channel with drops enabled, or press Reload if campaigns are empty."
                  />
                )}
              </CardContent>
            </Card>

            <Card className="flex shrink-0 flex-col overflow-hidden lg:min-h-[8rem] lg:shrink lg:flex-1">
              <CardHeader className="flex-row items-center justify-between gap-2 pb-3 lg:p-4 lg:pb-2">
                <CardTitle className="text-sm">Output</CardTitle>
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {(live?.logs ?? []).length} events
                </span>
              </CardHeader>
              <CardContent className="pt-0 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:p-4 lg:pt-0">
                <LogConsole
                  logs={live?.logs ?? []}
                  className="lg:min-h-0 lg:flex-1"
                  scrollClassName="h-44 lg:h-auto"
                />
              </CardContent>
            </Card>
          </div>

          <div className="relative order-2 min-h-0">
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

function MiningPanel({
  mining,
  campaignRemainingSec,
  dropRemainingSec,
}: {
  mining: ActiveMiningView;
  campaignRemainingSec: number;
  dropRemainingSec: number;
}) {
  const gameImg = resolveGameImageUrl({
    gameImageUrl: mining.gameImageUrl,
    gameName: mining.gameName,
  });

  return (
    <>
      <div className="grid shrink-0 gap-3 md:grid-cols-2">
        <ProgressBlock
          eyebrow="Campaign"
          image={
            <TwitchImage
              src={gameImg}
              fallbackSrc={resolveGameImageUrl({ gameName: mining.gameName })}
              alt={mining.gameName}
              className="h-[4.5rem] w-[3.375rem] rounded-lg object-cover ring-1 ring-inset ring-white/10 lg:h-16 lg:w-12"
              fallbackClassName="h-[4.5rem] w-[3.375rem] rounded-lg bg-white/[0.05] lg:h-16 lg:w-12"
            />
          }
          title={mining.campaignName}
          subtitle={mining.gameName}
          percent={mining.campaignProgress}
          meta={`${mining.campaignClaimed}/${mining.campaignTotal} drops`}
          countdown={mining.campaignRemainingMinutes > 0 ? formatWatchRemaining(campaignRemainingSec) : null}
        />

        <ProgressBlock
          eyebrow="Current drop"
          image={
            <TwitchImage
              src={mining.dropImageUrl || gameImg}
              fallbackSrc={gameImg}
              alt={mining.dropName}
              className="h-[4.5rem] w-[4.5rem] rounded-lg object-cover ring-1 ring-inset ring-white/10 lg:h-16 lg:w-16"
              fallbackClassName="h-[4.5rem] w-[4.5rem] rounded-lg bg-white/[0.05] lg:h-16 lg:w-16"
            />
          }
          title={mining.dropName}
          subtitle={`${mining.dropCurrentMinutes}/${mining.dropRequiredMinutes} minutes watched`}
          percent={mining.dropProgress}
          meta={`${mining.dropProgress.toFixed(1)}%`}
          countdown={mining.dropRemainingMinutes > 0 ? formatWatchRemaining(dropRemainingSec) : null}
          highlight
        />
      </div>

      <div className="grid gap-4 border-t border-white/[0.05] pt-4 sm:grid-cols-2 lg:gap-3 lg:pt-3">
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
  );
}

function ProgressBlock({
  eyebrow,
  image,
  title,
  subtitle,
  percent,
  meta,
  countdown,
  highlight = false,
}: {
  eyebrow: string;
  image: React.ReactNode;
  title: string;
  subtitle: string;
  percent: number;
  meta: string;
  countdown: string | null;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-3.5 rounded-xl border p-3.5 lg:gap-3 lg:p-3",
        highlight ? "border-primary/25 bg-primary/[0.05]" : "border-white/[0.06] bg-white/[0.02]"
      )}
    >
      {image}
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
            {eyebrow}
          </p>
          <p className="truncate text-sm font-medium leading-snug tracking-tight" title={title}>
            {title || "—"}
          </p>
          <p className="truncate text-2xs text-muted-foreground">{subtitle}</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-2xs">
            <span className="tabular-nums text-muted-foreground">{meta}</span>
            <span className="font-semibold tabular-nums">{percent.toFixed(1)}%</span>
          </div>
          <Progress value={percent} className="h-1.5" tone={highlight ? "brand" : "success"} />
          {countdown && (
            <p className="font-mono text-xs tabular-nums text-primary">{countdown} remaining</p>
          )}
        </div>
      </div>
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
  const onlineCount = channels.filter((c) => c.online).length;

  return (
    <Card className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
      <CardHeader className="shrink-0 gap-1.5 border-b border-white/[0.05] pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Channels</CardTitle>
          <Badge variant={onlineCount > 0 ? "success" : "neutral"}>
            {onlineCount} live
          </Badge>
        </div>
        <p className="truncate text-2xs text-muted-foreground">
          {focusedGameName
            ? `${focusedGameName}${focusedCampaignName ? ` · ${focusedCampaignName}` : ""}`
            : "Manual switch · drops-enabled first"}
        </p>
      </CardHeader>
      <CardContent className="scroll-slim space-y-2 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {channels.length === 0 && (
          <EmptyState
            compact
            icon={Users}
            title="No channels yet"
            description="The miner lists channels once a campaign is active."
          />
        )}

        {channels.map((ch) => {
          const isWatching = watchingChannel === ch.login;
          return (
            <div
              key={`${ch.id}-${ch.login}`}
              className={cn(
                "space-y-2.5 rounded-xl border p-3 transition-colors",
                isWatching
                  ? "border-primary/35 bg-primary/[0.07]"
                  : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]"
              )}
            >
              <div className="flex items-start gap-2">
                <StatusDot
                  tone={ch.online ? "live" : "stopped"}
                  className="mt-1.5"
                  pulse={ch.online && isWatching}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium leading-snug">
                    {ch.displayName || ch.login}
                  </p>
                  <p className="truncate text-2xs text-muted-foreground">
                    {ch.gameName || "—"}
                    {ch.online ? ` · ${ch.viewers.toLocaleString()} viewers` : " · Offline"}
                  </p>
                </div>
                <Badge variant={isWatching ? "primary" : "outline"} className="shrink-0">
                  Drops
                </Badge>
              </div>

              <Button
                size="sm"
                variant={isWatching ? "accent" : "secondary"}
                className="w-full"
                disabled={switching === ch.login}
                loading={switching === ch.login}
                onClick={() => onSwitch(ch.login)}
              >
                {switching === ch.login ? "Switching…" : isWatching ? "Watching" : "Switch"}
              </Button>
            </div>
          );
        })}
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
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
          {title}
        </p>
        <span className="text-2xs tabular-nums text-muted-foreground/70">{drops.length}</span>
      </div>

      <div className="scroll-slim space-y-1.5 lg:max-h-40 lg:overflow-y-auto lg:pr-1">
        {drops.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/[0.07] px-3 py-2.5 text-2xs text-muted-foreground">
            {emptyText}
          </p>
        )}

        {drops.map((drop) => {
          const isSub = variant === "upcoming" && drop.requiredMinutes <= 0;
          return (
            <div
              key={drop.id}
              className={cn(
                "flex items-center gap-2.5 rounded-lg border p-2",
                variant === "claimed" && "border-success/25 bg-success/[0.06]",
                variant === "upcoming" && !isSub && "border-white/[0.06] bg-white/[0.02]",
                isSub && "border-warning/25 bg-warning/[0.06]"
              )}
            >
              {variant === "claimed" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle
                  className={cn("h-4 w-4 shrink-0", isSub ? "text-warning" : "text-muted-foreground/60")}
                />
              )}
              <TwitchImage
                src={drop.imageUrl || gameImg}
                fallbackSrc={gameImg}
                alt={drop.name}
                className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-inset ring-white/10 lg:h-8 lg:w-8"
                fallbackClassName="h-9 w-9 shrink-0 rounded-md bg-white/[0.05] lg:h-8 lg:w-8"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{drop.name}</p>
                <p className={cn("truncate text-2xs", isSub ? "text-warning" : "text-muted-foreground")}>
                  {variant === "claimed"
                    ? `${drop.requiredMinutes} min`
                    : isSub
                      ? "Subscribe to a channel to unlock"
                      : `${drop.requiredMinutes} min required`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
