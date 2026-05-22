import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const FILTER_LABELS: { key: keyof InventoryFilterState; label: string }[] = [
  { key: "notLinked", label: "Not linked" },
  { key: "upcoming", label: "Upcoming" },
  { key: "expired", label: "Expired" },
  { key: "excluded", label: "Excluded" },
  { key: "finished", label: "Finished" },
];

function campaignStatusLabel(c: InventoryCampaign): { text: string; className: string } {
  const now = Date.now();
  const start = Date.parse(c.startsAt);
  const end = Date.parse(c.endsAt);
  if (c.status === "EXPIRED" || (Number.isFinite(end) && end <= now)) {
    return { text: "Expired", className: "text-red-400" };
  }
  if (Number.isFinite(start) && now < start) {
    return { text: "Upcoming", className: "text-amber-400" };
  }
  return { text: "Active", className: "text-emerald-400" };
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
  const allCampaigns = useMemo(
    () => (live?.campaigns ?? []) as InventoryCampaign[],
    [live?.campaigns]
  );

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
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (user?.role === "admin") {
    return (
      <DashboardPage>
        <div className="shrink-0">
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-muted-foreground mt-2">Available for user accounts with a linked Twitch profile.</p>
        </div>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage>
      <div className="mb-4 shrink-0 space-y-4">
        <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-muted-foreground">
            All drop campaigns and rewards — filters match TwitchDropsMiner.
            {allCampaigns.length > 0 && (
              <span className="block text-xs mt-1">
                {allCampaigns.length} loaded · {visibleCampaigns.length} visible with current filters
                {reloading && " · reloading from Twitch…"}
                {!reloading && allCampaigns.length === 0 && live?.state === "IDLE" && " · loading…"}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={reloading}>
          <RefreshCw className={cn("h-4 w-4 mr-2", reloading && "animate-spin")} />
          Reload
        </Button>
        </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Show</CardTitle>
          <CardDescription>Toggle which campaigns appear below</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {FILTER_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                className="rounded border-border"
                checked={filters[key]}
                onChange={() => toggleFilter(key)}
              />
              {label}
            </label>
          ))}
        </CardContent>
      </Card>
      </div>

      <DashboardScrollArea>
      <div className="space-y-4 pb-2">
        {visibleCampaigns.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm space-y-2">
              {allCampaigns.length === 0 ? (
                <p>No campaigns loaded yet. Press Reload to fetch from Twitch.</p>
              ) : (
                <>
                  <p>
                    No campaigns match the current filters ({allCampaigns.length} loaded).
                  </p>
                  <p className="text-xs">
                    Enable &quot;Excluded&quot; or &quot;Upcoming&quot;, or turn off &quot;Not linked&quot; if needed.
                    The actively mined campaign is always shown.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {visibleCampaigns.map((campaign) => {
          const statusInfo = campaignStatusLabel(campaign);
          const claimed = campaign.drops.filter((d) => d.isClaimed).length;
          const isPinned = pinnedCampaignIds.includes(campaign.id);
          const gameImg = resolveGameImageUrl(campaign);
          return (
            <Card key={campaign.id} className="overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex gap-4 items-start">
                  <TwitchImage
                    src={gameImg}
                    fallbackSrc={resolveGameImageUrl({ gameName: campaign.gameName, gameSlug: campaign.gameSlug })}
                    alt={campaign.gameName}
                    className="h-24 w-[4.5rem] rounded object-cover shrink-0 bg-muted"
                    fallbackClassName="h-24 w-[4.5rem] rounded bg-muted shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <CardTitle className="text-lg leading-tight">{campaign.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">{campaign.gameName}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className={statusInfo.className}>{statusInfo.text}</span>
                      <span className={campaign.linked ? "text-emerald-400" : "text-red-400"}>
                        {campaign.linked ? "Linked" : "Not linked"}
                      </span>
                      {isPinned && <span className="text-primary">Mining now</span>}
                      <span className="text-muted-foreground">
                        Drops {claimed}/{campaign.drops.length}
                      </span>
                      {campaign.endsAt && (
                        <span className="text-muted-foreground">
                          Ends {new Date(campaign.endsAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {campaign.drops.map((drop) => {
                    const st = dropInventoryStatus(drop);
                    return (
                      <div
                        key={drop.id}
                        className={cn(
                          "shrink-0 w-28 rounded-lg border p-2 text-center space-y-2",
                          st === "claimed" && "border-emerald-500/40 bg-emerald-500/5",
                          st === "ready" && "border-amber-500/40 bg-amber-500/5",
                          st === "progress" && "border-primary/30 bg-primary/5",
                          st === "pending" && "border-border/60"
                        )}
                      >
                        <TwitchImage
                          src={dropImageUrl(drop, campaign)}
                          fallbackSrc={gameImg}
                          alt={drop.name}
                          className="h-16 w-16 mx-auto rounded object-cover bg-muted"
                          fallbackClassName="h-16 w-16 mx-auto rounded bg-muted"
                        />
                        <p className="text-[11px] font-medium leading-tight line-clamp-2 min-h-[2rem]">
                          {drop.name}
                        </p>
                        <p
                          className={cn(
                            "text-[10px]",
                            st === "claimed" && "text-emerald-400",
                            st === "ready" && "text-amber-400",
                            st === "progress" && "text-primary",
                            st === "pending" && "text-muted-foreground"
                          )}
                        >
                          {st === "claimed" && "Claimed"}
                          {st === "ready" && "Ready to claim"}
                          {st === "progress" &&
                            (drop.requiredMinutes > 0
                              ? `${Math.round((drop.currentMinutes / drop.requiredMinutes) * 1000) / 10}% (${drop.currentMinutes}/${drop.requiredMinutes} min)`
                              : "In progress")}
                          {st === "pending" &&
                            (drop.requiredMinutes > 0
                              ? `${drop.requiredMinutes} min`
                              : "Subscribe")}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
