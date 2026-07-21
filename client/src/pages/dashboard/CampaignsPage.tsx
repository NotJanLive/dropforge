import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionFeedback, DropListsEditor } from "@/components/DropListsEditor";
import { api } from "@/lib/api";
import { buildGameOptions } from "@/lib/campaignGames";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";

type CampaignItem = {
  id: string;
  name: string;
  gameName: string;
  gameImageUrl: string;
  status: string;
  linked: boolean;
  endsAt: string;
  dropCount: number;
};

type Feedback = { type: "success" | "error"; message: string } | null;

export function CampaignsPage() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [priorityGames, setPriorityGames] = useState<string[]>([]);
  const [excludeGames, setExcludeGames] = useState<string[]>([]);
  const [priorityMode, setPriorityMode] = useState("PRIORITY_ONLY");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const loadCached = async () => {
    if (user?.role !== "user") return;
    setFeedback(null);
    try {
      const [c, s] = await Promise.all([api.campaigns(), api.minerSettings()]);
      setCampaigns(c.campaigns);
      setPriorityGames(s.priorityGames);
      setExcludeGames(s.excludeGames);
      setPriorityMode(s.priorityMode);
      setDirty(false);
      setSettingsLoaded(true);
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load campaigns",
      });
    }
  };

  const refreshFromTwitch = async () => {
    if (user?.role !== "user") return;
    setRefreshing(true);
    setFeedback(null);
    try {
      const [c, s] = await Promise.all([api.campaigns({ refresh: true }), api.minerSettings()]);
      setCampaigns(c.campaigns);
      setPriorityGames(s.priorityGames);
      setExcludeGames(s.excludeGames);
      setPriorityMode(s.priorityMode);
      setDirty(false);
      setSettingsLoaded(true);
      setFeedback({ type: "success", message: `Refreshed — ${c.campaigns.length} campaigns from Twitch.` });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to refresh campaigns",
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadCached().catch(() => undefined);
  }, [user]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  const games = useMemo(
    () =>
      buildGameOptions(
        campaigns.map((c) => ({
          gameName: c.gameName,
          gameImageUrl: c.gameImageUrl,
          status: c.status,
          linked: c.linked,
        }))
      ),
    [campaigns]
  );

  const save = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await api.updateMinerSettings({ priorityGames, excludeGames, priorityMode });
      setDirty(false);
      setFeedback({
        type: "success",
        message: "Drop lists saved — miner updated.",
      });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save settings",
      });
    } finally {
      setSaving(false);
    }
  };

  const reloadMiner = async () => {
    setReloading(true);
    setFeedback(null);
    try {
      await api.minerReload();
      setFeedback({ type: "success", message: "Miner reloaded with current Twitch inventory." });
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to reload miner",
      });
    } finally {
      setReloading(false);
    }
  };

  const markDirty = () => setDirty(true);

  if (user?.role === "admin") {
    return (
      <DashboardPage>
        <div className="shrink-0 space-y-2">
          <h1 className="text-2xl font-semibold">Drop lists</h1>
          <p className="text-muted-foreground">Drop lists are configured per user account.</p>
        </div>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold sm:text-2xl">Drop lists</h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Choose which games to prioritize or skip. Save your changes, then reload to apply them.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refreshFromTwitch()} disabled={refreshing || saving || reloading}>
            {refreshing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {refreshing ? "Refreshing…" : "Refresh games"}
          </Button>
          <Button
            variant="outline"
            onClick={save}
            disabled={!settingsLoaded || saving || refreshing || reloading}
            className={cn(dirty && "border-primary/50")}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : dirty ? (
              <Save className="h-4 w-4 mr-2" />
            ) : (
              <Check className="h-4 w-4 mr-2" />
            )}
            {saving ? "Saving…" : dirty ? "Save" : "Save"}
          </Button>
          <Button onClick={reloadMiner} disabled={reloading || saving || refreshing}>
            {reloading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {reloading ? "Reloading…" : "Reload miner"}
          </Button>
          </div>
        </div>
        <ActionFeedback feedback={feedback} />
      </div>

      <DashboardScrollArea className="flex flex-col gap-4 pb-2 sm:gap-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <div className="shrink-0">
          <DropListsEditor
            games={games}
            priorityGames={priorityGames}
            excludeGames={excludeGames}
            priorityMode={priorityMode}
            onPriorityGamesChange={(g) => {
              setPriorityGames(g);
              markDirty();
            }}
            onExcludeGamesChange={(g) => {
              setExcludeGames(g);
              markDirty();
            }}
            onPriorityModeChange={(m) => {
              setPriorityMode(m);
              markDirty();
            }}
          />
        </div>

        <Card className="flex min-h-0 flex-col lg:flex-1 lg:overflow-hidden">
          <CardHeader className="shrink-0 pb-3">
            <CardTitle className="text-base">Available games</CardTitle>
            <CardDescription>
              {games.length} games with drop campaigns on Twitch (read-only overview)
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
            <div className="grid gap-2 pb-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {games.map((g) => {
                const inPriority = priorityGames.includes(g.name);
                const ignored = excludeGames.includes(g.name);
                return (
                  <div
                    key={g.name}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border p-2 text-sm",
                      inPriority && "border-primary/40 bg-primary/5",
                      ignored && "opacity-50 border-border/40"
                    )}
                  >
                    {g.imageUrl ? (
                      <img
                        src={resolveGameImageUrl({ gameImageUrl: g.imageUrl, gameName: g.name })}
                        alt=""
                        className="h-9 w-7 shrink-0 rounded object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="h-9 w-7 shrink-0 rounded bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {g.campaignCount} campaign{g.campaignCount === 1 ? "" : "s"}
                        {!g.linked && " · link account"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
