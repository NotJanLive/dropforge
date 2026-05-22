import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type ChannelInfo, type MinerStatus } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMinerWebSocket } from "@/hooks/useMinerWebSocket";
import { DashboardPage, DashboardPageHeader, DashboardScrollArea } from "@/components/DashboardPage";

export function ChannelsPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const wsStatus = useMinerWebSocket(user?.role === "user" ? user.id : null);

  useEffect(() => {
    if (user?.role !== "user") return;
    api.minerStatus().then((r) => setStatus(r.status)).catch(() => undefined);
    const interval = setInterval(() => {
      api.minerStatus().then((r) => setStatus(r.status)).catch(() => undefined);
    }, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const live = wsStatus ?? status;
  const channels = live?.channels ?? [];

  const switchTo = async (login: string) => {
    await api.switchChannel(login);
  };

  if (user?.role === "admin") {
    return (
      <DashboardPage>
        <DashboardPageHeader>
          <h1 className="text-2xl font-semibold">Channels</h1>
          <p className="text-muted-foreground mt-2">Channel monitoring is available on user accounts with linked Twitch.</p>
        </DashboardPageHeader>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage>
      <DashboardPageHeader>
        <h1 className="text-2xl font-semibold">Channels</h1>
        <p className="text-muted-foreground">
          Live channels for the active campaign. Currently watching: {live?.watchingChannel ?? "none"}
          {live?.focusedGameName ? ` · ${live.focusedGameName}` : ""}
        </p>
      </DashboardPageHeader>

      <DashboardScrollArea>
      <div className="grid gap-3 pb-2">
        {channels.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No channels tracked yet. The miner discovers channels when campaigns are active.
            </CardContent>
          </Card>
        )}
        {channels.map((ch: ChannelInfo) => (
          <Card key={ch.id}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{ch.displayName || ch.login}</CardTitle>
                  <CardDescription>
                    {ch.gameName} · {ch.online ? `${ch.viewers.toLocaleString()} viewers` : "Offline"}
                    {ch.aclPreferred && " · ACL"}
                    {ch.campaignIds.length > 1 && ` · ${ch.campaignIds.length} campaigns`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${ch.online ? "bg-emerald-400" : "bg-muted-foreground"}`} />
                  {ch.online && (
                    <Button size="sm" variant={live?.watchingChannel === ch.login ? "default" : "outline"} onClick={() => switchTo(ch.login)}>
                      {live?.watchingChannel === ch.login ? "Watching" : "Switch"}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
