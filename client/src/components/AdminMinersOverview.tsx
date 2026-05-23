import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronDown, Radio, RefreshCw, Terminal, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api, type AdminUserMinerView, type MinerLogEntry } from "@/lib/api";
import { formatWatchRemaining, useWatchRemainingFromMinutes, useWatchRemainingSeconds } from "@/lib/miningDisplay";
import { TwitchImage } from "@/components/TwitchImage";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { cn } from "@/lib/utils";
import { DashboardScrollArea } from "@/components/DashboardPage";

const POLL_MS = 5000;

function stateBadgeClass(state: string): string {
  switch (state) {
    case "WATCHING":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "IDLE":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "ERROR":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    case "STOPPED":
      return "border-border/60 bg-muted/40 text-muted-foreground";
    default:
      return "border-primary/40 bg-primary/10 text-primary";
  }
}

function MinerLogLine({ entry }: { entry: MinerLogEntry }) {
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

function AdminUserMinerCard({
  miner,
  expanded,
  onToggle,
}: {
  miner: AdminUserMinerView;
  expanded: boolean;
  onToggle: () => void;
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
      <CardHeader className="cursor-pointer space-y-2.5 p-4 pb-3 sm:space-y-3" onClick={onToggle}>
        <div className="flex items-start gap-2.5 sm:gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 sm:h-10 sm:w-10">
            <User className="h-3.5 w-3.5 text-primary sm:h-4 sm:w-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="truncate text-sm sm:text-base">{miner.username}</CardTitle>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium sm:text-xs",
                    stateBadgeClass(miner.status.state)
                  )}
                >
                  {miner.status.state}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    expanded && "rotate-180"
                  )}
                />
              </div>
            </div>
            <CardDescription className="text-xs leading-snug sm:text-sm">
              {miner.twitchLinked
                ? `@${miner.twitchLogin ?? "linked"}`
                : "No Twitch"}
              {!miner.setupComplete && " · Setup pending"}
              {miner.minerRunning ? " · Active" : " · Offline"}
            </CardDescription>
          </div>
        </div>

        <p className="line-clamp-2 text-xs text-muted-foreground sm:text-sm">{miner.status.message}</p>

        <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
          <div className="min-w-0 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 sm:rounded-lg sm:px-3 sm:py-2">
            <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Watching</p>
            <p className="truncate text-xs font-medium sm:text-sm">
              {miner.status.watchingChannel ?? "—"}
            </p>
          </div>
          <div className="min-w-0 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 sm:rounded-lg sm:px-3 sm:py-2">
            <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Campaign</p>
            <p className="truncate text-xs font-medium sm:text-sm">
              {mining?.campaignName ?? miner.status.focusedCampaignName ?? "—"}
            </p>
          </div>
          <div className="min-w-0 rounded-md border border-border/60 bg-card/50 px-2 py-1.5 sm:rounded-lg sm:px-3 sm:py-2">
            <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Drop</p>
            <p className="truncate text-xs font-medium sm:text-sm">{mining?.dropName ?? "—"}</p>
          </div>
        </div>

        {mining && !expanded && (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
              <span className="text-muted-foreground">Campaign</span>
              <span className="font-medium tabular-nums">
                {mining.campaignProgress.toFixed(0)}%
              </span>
            </div>
            <Progress value={mining.campaignProgress} className="h-1.5" />
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 border-t border-border/60 p-4 pt-4 sm:p-6 sm:pt-4">
          {mining ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <div className="flex items-start gap-3">
                  <TwitchImage
                    src={resolveGameImageUrl({ gameImageUrl: mining.gameImageUrl, gameName: mining.gameName })}
                    fallbackSrc={resolveGameImageUrl({ gameName: mining.gameName })}
                    alt={mining.gameName}
                    className="h-14 w-10 shrink-0 rounded object-cover bg-muted"
                    fallbackClassName="h-14 w-10 shrink-0 rounded bg-muted"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Game: </span>
                      <span className="font-medium">{mining.gameName}</span>
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Campaign: </span>
                      <span className="font-medium">{mining.campaignName}</span>
                    </p>
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium tabular-nums">
                          {mining.campaignProgress.toFixed(1)}% ({mining.campaignClaimed}/{mining.campaignTotal})
                        </span>
                      </div>
                      <Progress value={mining.campaignProgress} className="h-2" />
                      {mining.campaignRemainingMinutes > 0 && (
                        <p className="text-xs font-mono tabular-nums text-primary">
                          {formatWatchRemaining(campaignRemainingSec)} remaining
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <div className="flex items-start gap-3">
                  <TwitchImage
                    src={
                      mining.dropImageUrl ||
                      resolveGameImageUrl({ gameImageUrl: mining.gameImageUrl, gameName: mining.gameName })
                    }
                    fallbackSrc={resolveGameImageUrl({ gameImageUrl: mining.gameImageUrl, gameName: mining.gameName })}
                    alt={mining.dropName}
                    className="h-14 w-14 shrink-0 rounded object-cover bg-muted"
                    fallbackClassName="h-14 w-14 shrink-0 rounded bg-muted"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Drop: </span>
                      <span className="font-medium">{mining.dropName}</span>
                    </p>
                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">Progress</span>
                        <span className="font-medium tabular-nums">{mining.dropProgress.toFixed(1)}%</span>
                      </div>
                      <Progress value={mining.dropProgress} className="h-2" />
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {mining.dropCurrentMinutes}/{mining.dropRequiredMinutes} minutes watched
                      </p>
                      {mining.dropRemainingMinutes > 0 && (
                        <p className="text-xs font-mono tabular-nums text-primary">
                          {formatWatchRemaining(dropRemainingSec)} remaining
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active mining session for this user.</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Claimed drops</p>
              <p className="text-sm">
                {mining?.claimedDrops?.length
                  ? `${mining.claimedDrops.length} drop${mining.claimedDrops.length === 1 ? "" : "s"}`
                  : "None"}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Up next</p>
              <p className="text-sm">
                {mining?.upcomingDrops?.length
                  ? `${mining.upcomingDrops.length} drop${mining.upcomingDrops.length === 1 ? "" : "s"}`
                  : "None"}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Radio className="h-3.5 w-3.5" />
                Channels
              </p>
              <p className="text-sm">{miner.status.channels.length} loaded</p>
              {miner.status.channels.slice(0, 3).map((ch) => (
                <p key={ch.login} className="truncate text-xs text-muted-foreground">
                  {ch.displayName || ch.login}
                  {miner.status.watchingChannel === ch.login ? " · watching" : ""}
                </p>
              ))}
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Activity className="h-3.5 w-3.5" />
                Live stats
              </p>
              <p className="text-xs text-muted-foreground">
                WS connections: {miner.status.websocketConnections}
              </p>
              <p className="text-xs text-muted-foreground">
                Last watch:{" "}
                {miner.status.lastWatchAt
                  ? new Date(miner.status.lastWatchAt).toLocaleTimeString()
                  : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                Updated: {new Date(miner.status.updatedAt).toLocaleTimeString()}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Terminal className="h-3.5 w-3.5" />
              Output logs
            </p>
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border/60 bg-black/40 p-3 font-mono text-xs space-y-1 dashboard-scroll">
              {(miner.status.logs ?? []).length === 0 && (
                <p className="text-muted-foreground">No log entries yet.</p>
              )}
              {(miner.status.logs ?? []).map((entry, i) => (
                <MinerLogLine key={`${entry.time}-${i}`} entry={entry} />
              ))}
            </div>
          </div>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold sm:text-2xl">Overview</h1>
          <p className="text-xs text-muted-foreground sm:text-sm">
            Live miner status · refresh {POLL_MS / 1000}s
            {lastUpdated ? ` · ${lastUpdated.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 min-h-10"
          onClick={() => load(true)}
          disabled={refreshing}
        >
          <RefreshCw className={cn("h-4 w-4 sm:mr-2", refreshing && "animate-spin")} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-lg border border-border/60 bg-card/50 px-2 py-2 text-center sm:px-3 sm:py-3">
          <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Users</p>
          <p className="text-lg font-semibold tabular-nums sm:text-2xl">{miners.length}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card/50 px-2 py-2 text-center sm:px-3 sm:py-3">
          <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Running</p>
          <p className="text-lg font-semibold tabular-nums sm:text-2xl">{activeCount}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card/50 px-2 py-2 text-center sm:px-3 sm:py-3">
          <p className="truncate text-[10px] text-muted-foreground sm:text-xs">Watching</p>
          <p className="text-lg font-semibold tabular-nums sm:text-2xl">{watchingCount}</p>
        </div>
      </div>

        {error && (
          <Card className="border-red-500/30 bg-red-500/5">
            <CardContent className="p-4 text-sm text-red-300">{error}</CardContent>
          </Card>
        )}

        {loading && miners.length === 0 && (
          <p className="text-sm text-muted-foreground">Loading miner status…</p>
        )}

        {!loading && miners.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No users yet. Create accounts under Users to start monitoring miners.
            </CardContent>
          </Card>
        )}

        {miners.map((miner) => (
          <AdminUserMinerCard
            key={miner.userId}
            miner={miner}
            expanded={expandedUserId === miner.userId}
            onToggle={() =>
              setExpandedUserId((current) => (current === miner.userId ? null : miner.userId))
            }
          />
        ))}
    </DashboardScrollArea>
  );
}
