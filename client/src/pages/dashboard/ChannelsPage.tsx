import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { api, type ChannelInfo, type MinerStatus } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useMinerWebSocket } from "@/hooks/useMinerWebSocket";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusDot } from "@/components/MinerState";
import { cn } from "@/lib/utils";

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
        <PageHeader
          title="Channels"
          description="Channel monitoring is available on user accounts with linked Twitch."
        />
      </DashboardPage>
    );
  }

  const onlineCount = channels.filter((c) => c.online).length;

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0">
        <PageHeader
          eyebrow="Live"
          title="Channels"
          description={
            <>
              Live channels for the active campaign. Currently watching:{" "}
              <span className="font-medium text-foreground">{live?.watchingChannel ?? "none"}</span>
              {live?.focusedGameName ? ` · ${live.focusedGameName}` : ""}
            </>
          }
          actions={
            <Badge variant={onlineCount > 0 ? "success" : "neutral"} size="md">
              {onlineCount} live · {channels.length} tracked
            </Badge>
          }
        />
      </div>

      <DashboardScrollArea>
        <div className="grid gap-2.5 pb-2 sm:grid-cols-2 xl:grid-cols-3">
          {channels.length === 0 && (
            <EmptyState
              className="sm:col-span-2 xl:col-span-3"
              icon={Radio}
              title="No channels tracked yet"
              description="The miner discovers channels when campaigns are active."
            />
          )}

          {channels.map((ch: ChannelInfo) => {
            const isWatching = live?.watchingChannel === ch.login;
            return (
              <Card
                key={ch.id}
                interactive
                className={cn("p-3.5", isWatching && "border-primary/35 bg-primary/[0.06]")}
              >
                <div className="flex items-start gap-2.5">
                  <StatusDot tone={ch.online ? "live" : "stopped"} className="mt-1.5" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold tracking-tight">
                      {ch.displayName || ch.login}
                    </p>
                    <p className="truncate text-2xs text-muted-foreground">
                      {ch.gameName} · {ch.online ? `${ch.viewers.toLocaleString()} viewers` : "Offline"}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {ch.aclPreferred && <Badge variant="primary">ACL</Badge>}
                      {ch.campaignIds.length > 1 && (
                        <Badge variant="neutral">{ch.campaignIds.length} campaigns</Badge>
                      )}
                      {isWatching && <Badge variant="success">Watching</Badge>}
                    </div>
                  </div>

                  {ch.online && (
                    <Button
                      size="sm"
                      className="shrink-0"
                      variant={isWatching ? "accent" : "secondary"}
                      onClick={() => switchTo(ch.login)}
                    >
                      {isWatching ? "Watching" : "Switch"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
