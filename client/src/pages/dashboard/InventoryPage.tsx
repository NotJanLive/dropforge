import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Check, Link2Off, Package, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { api, type MinerStatus } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMinerWebSocket } from "@/hooks/useMinerWebSocket";
import { TwitchImage } from "@/components/TwitchImage";
import { cn } from "@/lib/utils";
import { resolveGameImageUrl, dropImageUrl } from "@/lib/gameImage";
import {
  campaignMatchesInventoryFilters,
  defaultInventoryFilters,
  dropInventoryStatus,
  sortCampaignsByPriority,
  type InventoryCampaign,
  type InventoryFilterState,
} from "@/lib/inventoryFilters";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

const FILTER_LABELS: { key: keyof InventoryFilterState; label: string }[] = [
  { key: "notLinked", label: "Not linked" },
  { key: "upcoming", label: "Upcoming" },
  { key: "expired", label: "Expired" },
  { key: "excluded", label: "Excluded" },
  { key: "finished", label: "Finished" },
];

function campaignStatusBadge(c: InventoryCampaign): {
  text: string;
  variant: "success" | "warning" | "danger";
} {
  const now = Date.now();
  const start = Date.parse(c.startsAt);
  const end = Date.parse(c.endsAt);
  if (c.status === "EXPIRED" || (Number.isFinite(end) && end <= now)) {
    return { text: "Expired", variant: "danger" };
  }
  if (Number.isFinite(start) && now < start) {
    return { text: "Upcoming", variant: "warning" };
  }
  return { text: "Active", variant: "success" };
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex select-none items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200 ease-spring",
        active
          ? "border-primary/40 bg-primary/12 text-foreground"
          : "border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:border-white/[0.16] hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 items-center justify-center rounded-[0.3rem] border transition-colors",
          active ? "border-primary bg-primary text-primary-foreground" : "border-white/20"
        )}
      >
        {active && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
      </span>
      {label}
    </button>
  );
}

export function InventoryPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [priorityMode, setPriorityMode] = useState("PRIORITY_ONLY");
  const [priorityGames, setPriorityGames] = useState<string[]>([]);
  const [excludeGames, setExcludeGames] = useState<string[]>([]);
  const [filters, setFilters] = useState<InventoryFilterState>(() =>
    defaultInventoryFilters("PRIORITY_ONLY", [])
  );
  const [reloading, setReloading] = useState(false);
  const [, startTransition] = useTransition();
  const wsStatus = useMinerWebSocket(user?.role === "user" ? user.id : null);

  useEffect(() => {
    if (user?.role !== "user") return;
    let cancelled = false;

    Promise.all([api.minerStatus(), api.minerSettings()])
      .then(([s, settings]) => {
        if (cancelled) return;
        if (s.status) setStatus(s.status);
        setPriorityMode(settings.priorityMode);
        setPriorityGames(settings.priorityGames);
        setExcludeGames(settings.excludeGames);
        setFilters(defaultInventoryFilters(settings.priorityMode, settings.priorityGames));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [user]);

  const live = wsStatus ?? status;
  const rawCampaigns = live?.campaigns as InventoryCampaign[] | undefined;
  const campaignsRef = useRef<InventoryCampaign[]>([]);
  const allCampaigns = useMemo(() => {
    const incoming = rawCampaigns ?? [];
    if (incoming.length === 0 && campaignsRef.current.length === 0) return campaignsRef.current;
    if (incoming.length !== campaignsRef.current.length) {
      campaignsRef.current = incoming;
      return incoming;
    }
    for (let i = 0; i < incoming.length; i++) {
      const a = incoming[i];
      const b = campaignsRef.current[i];
      if (a.id !== b.id || a.drops.length !== b.drops.length) {
        campaignsRef.current = incoming;
        return incoming;
      }
      for (let j = 0; j < a.drops.length; j++) {
        const da = a.drops[j];
        const db = b.drops[j];
        if (
          da.isClaimed !== db.isClaimed ||
          da.currentMinutes !== db.currentMinutes ||
          da.canClaim !== db.canClaim
        ) {
          campaignsRef.current = incoming;
          return incoming;
        }
      }
    }
    return campaignsRef.current;
  }, [rawCampaigns]);

  const pinnedCampaignIds = useMemo(() => {
    const miningId = live?.activeMining?.campaignId;
    return miningId ? [miningId] : [];
  }, [live?.activeMining?.campaignId]);

  const visibleCampaigns = useMemo(() => {
    const filtered = allCampaigns.filter((c) =>
      campaignMatchesInventoryFilters(
        c,
        filters,
        { priorityMode, priorityGames, excludeGames },
        { pinnedCampaignIds }
      )
    );
    return sortCampaignsByPriority(filtered, {
      miningCampaignId: live?.activeMining?.campaignId ?? null,
    });
  }, [
    allCampaigns,
    filters,
    priorityMode,
    priorityGames,
    excludeGames,
    pinnedCampaignIds,
    live?.activeMining?.campaignId,
  ]);

  const reload = async () => {
    setReloading(true);
    try {
      const result = await api.minerReload();
      if (result.status) setStatus(result.status);
    } finally {
      setReloading(false);
    }
  };

  const toggleFilter = (key: keyof InventoryFilterState) => {
    startTransition(() => {
      setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
    });
  };

  if (user?.role === "admin") {
    return (
      <DashboardPage>
        <PageHeader
          title="Inventory"
          description="Available for user accounts with a linked Twitch profile."
        />
      </DashboardPage>
    );
  }

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0 space-y-4">
        <PageHeader
          eyebrow="Twitch"
          title="Inventory"
          description="All available drop campaigns and rewards for your linked Twitch account."
          actions={
            <Button
              variant="outline"
              size="sm"
              className="max-sm:w-full"
              onClick={reload}
              loading={reloading}
            >
              {!reloading && <RefreshCw className="h-4 w-4" />}
              Reload
            </Button>
          }
        />

        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-card/50 p-3.5 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
              Show
            </span>
            {FILTER_LABELS.map(({ key, label }) => (
              <FilterChip
                key={key}
                label={label}
                active={filters[key]}
                onClick={() => toggleFilter(key)}
              />
            ))}
          </div>
          <p className="shrink-0 text-2xs tabular-nums text-muted-foreground">
            {allCampaigns.length} loaded · {visibleCampaigns.length} visible
            {reloading && " · reloading…"}
          </p>
        </div>
      </div>

      <DashboardScrollArea className="space-y-3.5 pb-2">
        {visibleCampaigns.some((c) => !c.linked) && (
          <Alert tone="warning" icon={Link2Off} title="Some campaigns need a linked game account">
            Link your game account on Twitch before those drops can be claimed automatically.{" "}
            <a
              href="https://www.twitch.tv/drops/campaigns"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-warning underline underline-offset-2 hover:text-warning/80"
            >
              Manage connections
            </a>
          </Alert>
        )}

        {visibleCampaigns.length === 0 && (
          <EmptyState
            icon={Package}
            title={allCampaigns.length === 0 ? "No campaigns loaded yet" : "Nothing matches the filters"}
            description={
              allCampaigns.length === 0 ? (
                "Press Reload to fetch your campaigns from Twitch."
              ) : (
                <>
                  {allCampaigns.length} campaigns loaded. Enable “Excluded” or “Upcoming”, or turn off
                  “Not linked” if needed — the actively mined campaign is always shown.
                </>
              )
            }
          />
        )}

        {visibleCampaigns.map((campaign) => {
          const statusInfo = campaignStatusBadge(campaign);
          const claimed = campaign.drops.filter((d) => d.isClaimed).length;
          const isPinned = pinnedCampaignIds.includes(campaign.id);
          const gameImg = resolveGameImageUrl(campaign);
          const activeMiningDropId = live?.activeMining?.dropId;
          const activeMiningMinutes = live?.activeMining?.dropCurrentMinutes ?? 0;

          const claimedDrops = campaign.drops
            .filter((d) => dropInventoryStatus(d) === "claimed")
            .sort((a, b) => a.requiredMinutes - b.requiredMinutes);
          const activeDrops = campaign.drops.filter(
            (d) => d.id === activeMiningDropId && !d.isClaimed
          );
          const openDrops = campaign.drops
            .filter((d) => dropInventoryStatus(d) !== "claimed" && d.id !== activeMiningDropId)
            .sort((a, b) => a.requiredMinutes - b.requiredMinutes);
          const sortedDrops = [...claimedDrops, ...activeDrops, ...openDrops];
          const claimedPct =
            campaign.drops.length > 0 ? (claimed / campaign.drops.length) * 100 : 0;

          return (
            <Card
              key={campaign.id}
              className={cn("overflow-hidden", isPinned && "border-primary/30 bg-primary/[0.035]")}
            >
              <div className="flex gap-3.5 p-4 sm:gap-4 sm:p-5">
                <TwitchImage
                  src={gameImg}
                  fallbackSrc={resolveGameImageUrl({
                    gameName: campaign.gameName,
                    gameSlug: campaign.gameSlug,
                  })}
                  alt={campaign.gameName}
                  className="h-[5.5rem] w-[4.125rem] shrink-0 rounded-xl object-cover ring-1 ring-inset ring-white/10 sm:h-24 sm:w-[4.5rem]"
                  fallbackClassName="h-[5.5rem] w-[4.125rem] shrink-0 rounded-xl bg-white/[0.05] sm:h-24 sm:w-[4.5rem]"
                />

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0 space-y-0.5">
                    <h2 className="line-clamp-2 text-base font-semibold leading-snug tracking-tight">
                      {campaign.name}
                    </h2>
                    <p className="truncate text-sm text-muted-foreground">{campaign.gameName}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={statusInfo.variant}>{statusInfo.text}</Badge>
                    {isPinned && <Badge variant="primary">Mining now</Badge>}
                    {!campaign.linked && <Badge variant="warning">Not linked</Badge>}
                    <Badge variant="neutral" className="tabular-nums">
                      {claimed}/{campaign.drops.length} drops
                    </Badge>
                    {campaign.endsAt && (
                      <span className="text-2xs text-muted-foreground">
                        Ends {new Date(campaign.endsAt).toLocaleString()}
                      </span>
                    )}
                  </div>

                  <Progress
                    value={claimedPct}
                    className="h-1"
                    tone={claimedPct >= 100 ? "success" : "brand"}
                  />
                </div>
              </div>

              <CardContent className="p-0 pb-4 sm:pb-5">
                <div className="scroll-slim flex gap-2.5 overflow-x-auto px-4 pb-1 sm:px-5">
                  {sortedDrops.map((drop) => {
                    const st = dropInventoryStatus(drop);
                    const isActive = drop.id === activeMiningDropId;
                    const effectiveMinutes = isActive
                      ? activeMiningMinutes
                      : !drop.isClaimed && !isActive && isPinned && drop.requiredMinutes > 0
                        ? Math.min(activeMiningMinutes, drop.requiredMinutes)
                        : drop.currentMinutes;

                    const isSubDrop = st === "pending" && !isActive && drop.requiredMinutes <= 0;
                    const label =
                      st === "claimed"
                        ? "Claimed"
                        : st === "ready"
                          ? "Ready to claim"
                          : isActive || st === "progress"
                            ? drop.requiredMinutes > 0
                              ? effectiveMinutes >= drop.requiredMinutes
                                ? "Ready to claim"
                                : `${Math.round((effectiveMinutes / drop.requiredMinutes) * 1000) / 10}% (${effectiveMinutes}/${drop.requiredMinutes} min)`
                              : "In progress"
                            : drop.requiredMinutes > 0
                              ? effectiveMinutes > 0
                                ? `${Math.round((effectiveMinutes / drop.requiredMinutes) * 1000) / 10}% (${effectiveMinutes}/${drop.requiredMinutes} min)`
                                : `${drop.requiredMinutes} min`
                              : "Subscribe";

                    return (
                      <div
                        key={drop.id}
                        className={cn(
                          "w-28 shrink-0 space-y-2 rounded-xl border p-2 text-center transition-colors sm:w-36 sm:p-2.5",
                          st === "claimed" && "border-success/30 bg-success/[0.07]",
                          st === "ready" && "border-warning/35 bg-warning/[0.08]",
                          isActive && "border-primary/40 bg-primary/[0.08]",
                          !isActive && st === "progress" && "border-white/[0.07] bg-white/[0.02]",
                          isSubDrop && "border-warning/30 bg-warning/[0.06]",
                          st === "pending" &&
                            !isActive &&
                            drop.requiredMinutes > 0 &&
                            "border-white/[0.07] bg-white/[0.02]"
                        )}
                      >
                        <TwitchImage
                          src={dropImageUrl(drop, campaign)}
                          fallbackSrc={gameImg}
                          alt={drop.name}
                          className="mx-auto h-16 w-16 rounded-lg object-cover ring-1 ring-inset ring-white/10 sm:h-[4.5rem] sm:w-[4.5rem]"
                          fallbackClassName="mx-auto h-16 w-16 rounded-lg bg-white/[0.05] sm:h-[4.5rem] sm:w-[4.5rem]"
                        />
                        <p className="line-clamp-2 min-h-[2rem] text-2xs font-medium leading-tight sm:min-h-[2.6rem] sm:line-clamp-3">
                          {drop.name}
                        </p>
                        <p
                          className={cn(
                            "text-[0.625rem] font-medium tabular-nums",
                            st === "claimed" && "text-success",
                            st === "ready" && "text-warning",
                            isActive && "text-primary",
                            !isActive && st === "progress" && "text-muted-foreground",
                            isSubDrop && "text-warning",
                            st === "pending" &&
                              !isActive &&
                              drop.requiredMinutes > 0 &&
                              "text-muted-foreground"
                          )}
                        >
                          {label}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </DashboardScrollArea>
    </DashboardPage>
  );
}
