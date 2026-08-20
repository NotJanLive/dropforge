import { useEffect, useMemo, useState } from "react";
import { Check, Gamepad2, RefreshCw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActionFeedback, DropListsEditor } from "@/components/DropListsEditor";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { TwitchImage } from "@/components/TwitchImage";
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
      setFeedback({
        type: "success",
        message: `Refreshed — ${c.campaigns.length} campaigns from Twitch.`,
      });
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
      setFeedback({ type: "success", message: "Drop lists saved — miner updated." });
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
        <PageHeader title="Drop lists" description="Drop lists are configured per user account." />
      </DashboardPage>
    );
  }

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0 space-y-3.5">
        <PageHeader
          eyebrow="Mining rules"
          title="Drop lists"
          description="Choose which games to prioritize mining or skip mining."
          actions={
            <>
              <Button
                variant="outline"
                size="sm"
                className="max-sm:flex-1"
                onClick={() => refreshFromTwitch()}
                loading={refreshing}
                disabled={saving || reloading}
              >
                {!refreshing && <RefreshCw className="h-4 w-4" />}
                Refresh games
              </Button>
              <Button
                variant={dirty ? "default" : "outline"}
                size="sm"
                className={cn("max-sm:flex-1", dirty && "shadow-glow-sm")}
                onClick={save}
                loading={saving}
                disabled={!settingsLoaded || refreshing || reloading}
              >
                {!saving && (dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />)}
                {dirty ? "Save changes" : "Saved"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="max-sm:w-full"
                onClick={reloadMiner}
                loading={reloading}
                disabled={saving || refreshing}
              >
                {!reloading && <RefreshCw className="h-4 w-4" />}
                Reload miner
              </Button>
            </>
          }
        />
        <ActionFeedback feedback={feedback} />
      </div>

      <DashboardScrollArea className="space-y-4 pb-2 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
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
          <CardHeader className="shrink-0 gap-1.5 pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Gamepad2 className="h-4 w-4 text-muted-foreground" />
                Available games
              </CardTitle>
              <Badge variant="neutral" className="tabular-nums">
                {games.length}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Games with drop campaigns on Twitch — read-only overview
            </CardDescription>
          </CardHeader>

          <CardContent className="scroll-slim pt-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {games.length === 0 ? (
              <EmptyState
                compact
                icon={Gamepad2}
                title="No games loaded"
                description="Press “Refresh games” to fetch active drop campaigns from Twitch."
              />
            ) : (
              <div className="grid gap-2 pb-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {games.map((g) => {
                  const inPriority = priorityGames.includes(g.name);
                  const ignored = excludeGames.includes(g.name);
                  return (
                    <div
                      key={g.name}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border p-2 transition-colors",
                        inPriority
                          ? "border-primary/30 bg-primary/[0.06]"
                          : "border-white/[0.06] bg-white/[0.02]",
                        ignored && "opacity-45"
                      )}
                    >
                      <TwitchImage
                        src={resolveGameImageUrl({ gameImageUrl: g.imageUrl, gameName: g.name })}
                        fallbackSrc=""
                        alt=""
                        className="h-10 w-[1.875rem] shrink-0 rounded-md object-cover ring-1 ring-inset ring-white/10"
                        fallbackClassName="h-10 w-[1.875rem] shrink-0 rounded-md bg-white/[0.05]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{g.name}</p>
                        <p className="truncate text-2xs text-muted-foreground">
                          {g.campaignCount} campaign{g.campaignCount === 1 ? "" : "s"}
                          {!g.linked && " · link account"}
                        </p>
                      </div>
                      {inPriority && <Badge variant="primary">Priority</Badge>}
                      {ignored && <Badge variant="outline">Ignored</Badge>}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
