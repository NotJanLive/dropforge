import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronDown,
  Gauge,
  Play,
  Radio,
  RefreshCw,
  Square,
  Users as UsersIcon,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type AdminUserMinerView } from "@/lib/api";
import {
  formatWatchRemaining,
  useWatchRemainingFromMinutes,
  useWatchRemainingSeconds,
} from "@/lib/miningDisplay";
import { TwitchImage } from "@/components/TwitchImage";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { cn } from "@/lib/utils";
import { DashboardScrollArea } from "@/components/DashboardPage";
import { PageHeader } from "@/components/PageHeader";
import { CountTile } from "@/components/StatTile";
import { EmptyState } from "@/components/EmptyState";
import { LogConsole } from "@/components/LogConsole";
import { StatePill } from "@/components/MinerState";

const POLL_MS = 5000;

type AdminMinerAction = "reload" | "campaigns" | "start" | "stop";

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <p className="truncate text-[0.625rem] font-semibold uppercase tracking-micro text-muted-foreground">
        {label}
      </p>
      <p className="truncate text-xs font-medium sm:text-sm">{value}</p>
    </div>
  );
}

function AdminMinerControls({
  miner,
  busyAction,
  actionError,
  onAction,
}: {
  miner: AdminUserMinerView;
  busyAction: AdminMinerAction | null;
  actionError?: string;
  onAction: (action: AdminMinerAction) => void;
}) {
  const disabled = busyAction !== null;

  return (
    <div className="space-y-2.5">
      <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
        Admin actions
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !miner.twitchLinked}
          loading={busyAction === "campaigns"}
          onClick={() => onAction("campaigns")}
        >
          {busyAction !== "campaigns" && <RefreshCw className="h-3.5 w-3.5" />}
          Refresh campaigns
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !miner.twitchLinked}
          loading={busyAction === "reload"}
          onClick={() => onAction("reload")}
        >
          {busyAction !== "reload" && <RefreshCw className="h-3.5 w-3.5" />}
          Reload miner
        </Button>
        {!miner.minerRunning ? (
          <Button
            type="button"
            size="sm"
            variant="success"
            disabled={disabled || !miner.twitchLinked || !miner.setupComplete}
            loading={busyAction === "start"}
            onClick={() => onAction("start")}
          >
            {busyAction !== "start" && <Play className="h-3.5 w-3.5" />}
            Start miner
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="destructive"
            disabled={disabled}
            loading={busyAction === "stop"}
            onClick={() => onAction("stop")}
          >
            {busyAction !== "stop" && <Square className="h-3.5 w-3.5" />}
            Stop miner
          </Button>
        )}
      </div>
      {!miner.twitchLinked && (
        <p className="text-2xs text-muted-foreground">
          Link Twitch on the user account to enable miner actions.
        </p>
      )}
      {actionError && <p className="text-2xs text-danger">{actionError}</p>}
    </div>
  );
}

function AdminUserMinerCard({
  miner,
  expanded,
  busyAction,
  actionError,
  onToggle,
  onAction,
}: {
  miner: AdminUserMinerView;
  expanded: boolean;
  busyAction: AdminMinerAction | null;
  actionError?: string;
  onToggle: () => void;
  onAction: (action: AdminMinerAction) => void;
}) {
  const mining = miner.status.activeMining;
  const dropRemainingSec = useWatchRemainingSeconds(
    mining?.dropCurrentMinutes ?? 0,
    mining?.dropRequiredMinutes ?? 0,
    miner.status.lastWatchAt
  );
  const campaignRemainingSec = useWatchRemainingFromMinutes(
    mining?.campaignRemainingMinutes ?? 0,
    miner.status.lastWatchAt
  );

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full space-y-3 p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-semibold uppercase ring-1 ring-inset ring-primary/25">
            {miner.username.slice(0, 1)}
          </span>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold tracking-tight sm:text-base">
                {miner.username}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <StatePill state={miner.status.state} />
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform duration-200",
                    expanded && "rotate-180"
                  )}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
              <span className="truncate">
                {miner.twitchLinked ? `@${miner.twitchLogin ?? "linked"}` : "No Twitch"}
              </span>
              {!miner.setupComplete && <Badge variant="warning">Setup pending</Badge>}
              <Badge variant={miner.minerRunning ? "success" : "neutral"}>
                {miner.minerRunning ? "Active" : "Offline"}
              </Badge>
            </div>
          </div>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {miner.status.message}
        </p>

        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Watching" value={miner.status.watchingChannel ?? "—"} />
          <MiniStat
            label="Campaign"
            value={mining?.campaignName ?? miner.status.focusedCampaignName ?? "—"}
          />
          <MiniStat label="Drop" value={mining?.dropName ?? "—"} />
        </div>

        {mining && !expanded && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-2xs">
              <span className="text-muted-foreground">Campaign progress</span>
              <span className="font-semibold tabular-nums">
                {mining.campaignProgress.toFixed(0)}%
              </span>
            </div>
            <Progress value={mining.campaignProgress} className="h-1.5" />
          </div>
        )}
      </button>

      {expanded && (
        <CardContent className="space-y-4 border-t border-white/[0.05] p-4 pt-4 animate-fade-in sm:p-5">
          <AdminMinerControls
            miner={miner}
            busyAction={busyAction}
            actionError={actionError}
            onAction={onAction}
          />

          {mining ? (
            <div className="grid gap-3 xl:grid-cols-2">
              <div className="flex gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                <TwitchImage
                  src={resolveGameImageUrl({
                    gameImageUrl: mining.gameImageUrl,
                    gameName: mining.gameName,
                  })}
                  fallbackSrc={resolveGameImageUrl({ gameName: mining.gameName })}
                  alt={mining.gameName}
                  className="h-16 w-12 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-white/10"
                  fallbackClassName="h-16 w-12 shrink-0 rounded-lg bg-white/[0.05]"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0">
                    <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                      Campaign
                    </p>
                    <p className="truncate text-sm font-medium">{mining.campaignName}</p>
                    <p className="truncate text-2xs text-muted-foreground">{mining.gameName}</p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-2xs">
                      <span className="tabular-nums text-muted-foreground">
                        {mining.campaignClaimed}/{mining.campaignTotal} drops
                      </span>
                      <span className="font-semibold tabular-nums">
                        {mining.campaignProgress.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={mining.campaignProgress} className="h-1.5" />
                    {mining.campaignRemainingMinutes > 0 && (
                      <p className="font-mono text-2xs tabular-nums text-primary">
                        {formatWatchRemaining(campaignRemainingSec)} remaining
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 rounded-xl border border-primary/25 bg-primary/[0.05] p-3">
                <TwitchImage
                  src={
                    mining.dropImageUrl ||
                    resolveGameImageUrl({
                      gameImageUrl: mining.gameImageUrl,
                      gameName: mining.gameName,
                    })
                  }
                  fallbackSrc={resolveGameImageUrl({
                    gameImageUrl: mining.gameImageUrl,
                    gameName: mining.gameName,
                  })}
                  alt={mining.dropName}
                  className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-inset ring-white/10"
                  fallbackClassName="h-16 w-16 shrink-0 rounded-lg bg-white/[0.05]"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0">
                    <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                      Current drop
                    </p>
                    <p className="truncate text-sm font-medium">{mining.dropName}</p>
                    <p className="truncate text-2xs tabular-nums text-muted-foreground">
                      {mining.dropCurrentMinutes}/{mining.dropRequiredMinutes} minutes watched
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-2xs">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-semibold tabular-nums">
                        {mining.dropProgress.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={mining.dropProgress} className="h-1.5" />
                    {mining.dropRemainingMinutes > 0 && (
                      <p className="font-mono text-2xs tabular-nums text-primary">
                        {formatWatchRemaining(dropRemainingSec)} remaining
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              compact
              icon={Gauge}
              title="No active mining session"
              description="This user's miner is not watching a drop campaign right now."
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                Claimed drops
              </p>
              <p className="mt-1 text-sm">
                {mining?.claimedDrops?.length
                  ? `${mining.claimedDrops.length} drop${mining.claimedDrops.length === 1 ? "" : "s"}`
                  : "None"}
              </p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                Up next
              </p>
              <p className="mt-1 text-sm">
                {mining?.upcomingDrops?.length
                  ? `${mining.upcomingDrops.length} drop${mining.upcomingDrops.length === 1 ? "" : "s"}`
                  : "None"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                <Radio className="h-3.5 w-3.5" />
                Channels
              </p>
              <p className="mt-1 text-sm">{miner.status.channels.length} loaded</p>
              <div className="mt-1 space-y-0.5">
                {miner.status.channels.slice(0, 3).map((ch) => (
                  <p key={ch.login} className="truncate text-2xs text-muted-foreground">
                    {ch.displayName || ch.login}
                    {miner.status.watchingChannel === ch.login ? " · watching" : ""}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                Live stats
              </p>
              <dl className="mt-1 space-y-0.5 text-2xs text-muted-foreground">
                <div className="flex justify-between gap-2">
                  <dt>WS connections</dt>
                  <dd className="tabular-nums text-foreground">
                    {miner.status.websocketConnections}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Last watch</dt>
                  <dd className="tabular-nums text-foreground">
                    {miner.status.lastWatchAt
                      ? new Date(miner.status.lastWatchAt).toLocaleTimeString()
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Updated</dt>
                  <dd className="tabular-nums text-foreground">
                    {new Date(miner.status.updatedAt).toLocaleTimeString()}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <LogConsole
            title="Output logs"
            logs={miner.status.logs ?? []}
            emptyText="No log entries yet."
            scrollClassName="max-h-48"
          />
        </CardContent>
      )}
    </Card>
  );
}

export function AdminMinersOverview() {
  const [miners, setMiners] = useState<AdminUserMinerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busy, setBusy] = useState<{ userId: number; action: AdminMinerAction } | null>(null);
  const [actionErrors, setActionErrors] = useState<Record<number, string>>({});

  const updateMiner = useCallback((miner: AdminUserMinerView | null) => {
    if (!miner) return;
    setMiners((prev) => prev.map((m) => (m.userId === miner.userId ? miner : m)));
    setLastUpdated(new Date());
  }, []);

  const runUserAction = useCallback(
    async (userId: number, action: AdminMinerAction) => {
      setBusy({ userId, action });
      setActionErrors((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      try {
        const result =
          action === "reload"
            ? await api.adminReloadMiner(userId)
            : action === "campaigns"
              ? await api.adminRefreshCampaigns(userId)
              : action === "start"
                ? await api.adminStartMiner(userId)
                : await api.adminStopMiner(userId);
        updateMiner(result.miner);
      } catch (err) {
        setActionErrors((prev) => ({
          ...prev,
          [userId]: err instanceof Error ? err.message : "Action failed",
        }));
      } finally {
        setBusy(null);
      }
    },
    [updateMiner]
  );

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const result = await api.adminMiners();
      setMiners(result.miners);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load miners");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const id = window.setInterval(() => {
      load().catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const watchingCount = miners.filter((m) => m.status.state === "WATCHING").length;
  const activeCount = miners.filter((m) => m.minerRunning).length;

  return (
    <DashboardScrollArea className="space-y-4 pb-2">
      <PageHeader
        eyebrow={
          <>
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 animate-pulse-ring rounded-full bg-primary" />
              <span className="relative h-2 w-2 rounded-full bg-primary" />
            </span>
            Admin
          </>
        }
        title="Miner overview"
        description={
          <>
            Live status for every account · auto-refresh {POLL_MS / 1000}s
            {lastUpdated ? ` · updated ${lastUpdated.toLocaleTimeString()}` : ""}
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            className="max-sm:w-full"
            onClick={() => load(true)}
            loading={refreshing}
          >
            {!refreshing && <RefreshCw className="h-4 w-4" />}
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-3 lg:max-w-3xl">
        <CountTile icon={UsersIcon} label="Users" value={miners.length} />
        <CountTile icon={Gauge} label="Running" value={activeCount} tone="brand" />
        <CountTile icon={Radio} label="Watching" value={watchingCount} tone="success" />
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {loading && miners.length === 0 && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      )}

      {!loading && miners.length === 0 && (
        <EmptyState
          icon={UsersIcon}
          title="No users yet"
          description="Create accounts under Users to start monitoring miners."
        />
      )}

      <div className="space-y-3">
        {miners.map((miner) => (
          <AdminUserMinerCard
            key={miner.userId}
            miner={miner}
            expanded={expandedUserId === miner.userId}
            busyAction={busy?.userId === miner.userId ? busy.action : null}
            actionError={actionErrors[miner.userId]}
            onToggle={() =>
              setExpandedUserId((current) => (current === miner.userId ? null : miner.userId))
            }
            onAction={(action) => {
              void runUserAction(miner.userId, action);
            }}
          />
        ))}
      </div>
    </DashboardScrollArea>
  );
}
