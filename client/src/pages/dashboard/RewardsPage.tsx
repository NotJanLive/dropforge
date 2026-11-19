import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Award,
  Check,
  ExternalLink,
  Gift,
  ListPlus,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot } from "@/components/MinerState";
import { TwitchImage } from "@/components/TwitchImage";
import { useAuth } from "@/context/AuthContext";
import { useMinerWebSocket } from "@/hooks/useMinerWebSocket";
import {
  api,
  type CategoryChannel,
  type MinerStatus,
  type RewardCampaign,
  type RewardGroupInfo,
  type RewardKind,
  type RewardQueueState,
  type RewardQueueView,
  type RewardScanInfo,
} from "@/lib/api";
import {
  formatEndsIn,
  groupRewardTypes,
  requirementText,
  rewardImage,
  rewardTypeLabel,
} from "@/lib/rewards";
import { cn } from "@/lib/utils";

const stateLabel: Record<RewardQueueState, string> = {
  mining: "Mining",
  waiting: "Ready",
  offline: "Offline",
  paused: "Paused",
  claimable: "Claiming",
  locked: "Locked",
};

const stateVariant: Record<RewardQueueState, "success" | "primary" | "neutral" | "warning" | "info"> = {
  mining: "success",
  waiting: "primary",
  offline: "neutral",
  paused: "warning",
  claimable: "info",
  locked: "neutral",
};

type Feedback = { type: "success" | "error"; message: string } | null;

export function RewardsPage() {
  const { user } = useAuth();
  const wsStatus = useMinerWebSocket(user?.role === "user" ? user.id : null);
  const [status, setStatus] = useState<MinerStatus | null>(null);
  const [campaigns, setCampaigns] = useState<RewardCampaign[]>([]);
  const [scan, setScan] = useState<RewardScanInfo | null>(null);
  const [tab, setTab] = useState<RewardKind>("category");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [lookupName, setLookupName] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  // Newest of the websocket push and the last request's answer.
  const live =
    wsStatus && status
      ? Date.parse(wsStatus.updatedAt) >= Date.parse(status.updatedAt)
        ? wsStatus
        : status
      : wsStatus ?? status;
  const queue = live?.rewardQueue ?? [];
  const serverPinnedId = live?.pinnedRewardId ?? null;

  // Queue edits are applied locally at once and sent one after another, each
  // carrying the latest local state — quick clicks can no longer overwrite
  // each other or bring back a reward the miner just removed.
  const pendingRef = useRef(0);
  const [pending, setPending] = useState(0);
  const [local, setLocal] = useState<{ ids: string[]; pin: string | null } | null>(null);
  const localRef = useRef<{ ids: string[]; pin: string | null }>({ ids: [], pin: null });
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const serverIds = useMemo(() => queue.map((q) => q.id), [queue]);
  if (pending === 0) localRef.current = { ids: serverIds, pin: serverPinnedId };
  const ids = local?.ids ?? serverIds;
  const pinnedId = local ? local.pin : serverPinnedId;
  const queuedIds = useMemo(() => new Set(ids), [ids]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.rewards();
      setCampaigns(r.campaigns);
      setScan(r.scan);
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Failed to load rewards" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role !== "user") return;
    void load();
    api.minerStatus().then((r) => r.status && setStatus(r.status)).catch(() => undefined);
  }, [user]);

  // The first scan after a restart takes ~30 s — poll until it has finished.
  useEffect(() => {
    if (!scan || (!scan.scanning && scan.lastScanAt)) return;
    const t = setTimeout(() => void load(), 5000);
    return () => clearTimeout(t);
  }, [scan]);

  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  const mutate = (
    key: string,
    change: (ids: string[], pin: string | null) => { ids: string[]; pin: string | null }
  ) => {
    const next = change(localRef.current.ids, localRef.current.pin);
    localRef.current = next;
    setLocal(next);
    setSaving(key);
    pendingRef.current += 1;
    setPending(pendingRef.current);
    chainRef.current = chainRef.current.then(async () => {
      try {
        const { ids: sendIds, pin } = localRef.current;
        const r = await api.updateRewardQueue(sendIds, pin);
        if (r.status) setStatus(r.status);
        if (r.skipped > 0) {
          setFeedback({
            type: "error",
            message: "Some rewards could not be queued — the campaign may have just ended. Press Refresh and try again.",
          });
        }
      } catch (err) {
        setFeedback({ type: "error", message: err instanceof Error ? err.message : "Failed to update queue" });
      } finally {
        pendingRef.current -= 1;
        setPending(pendingRef.current);
        if (pendingRef.current === 0) {
          setLocal(null);
          setSaving(null);
        }
      }
    });
  };

  const addToQueue = (id: string) =>
    mutate(id, (cur, pin) => ({ ids: cur.includes(id) ? cur : [...cur, id], pin }));
  const togglePin = (id: string) =>
    mutate(id, (cur, pin) => ({ ids: cur.includes(id) ? cur : [id, ...cur], pin: pin === id ? null : id }));
  const removeFromQueue = (id: string) =>
    mutate(id, (cur, pin) => ({ ids: cur.filter((x) => x !== id), pin: pin === id ? null : pin }));
  const pickChannel = async (id: string, channel: string | null) => {
    setSaving(id);
    try {
      const r = await api.setRewardChannel(id, channel);
      if (r.status) setStatus(r.status);
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Failed to set channel" });
    } finally {
      setSaving(null);
    }
  };
  const move = (id: string, delta: number) =>
    mutate(id, (cur, pin) => {
      const i = cur.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return { ids: cur, pin };
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return { ids: next, pin };
    });

  // Queue rows in the locally edited order (server data per row).
  const queueRows = useMemo(() => {
    const byId = new Map(queue.map((q) => [q.id, q]));
    return ids
      .map((id) => byId.get(id))
      .filter((q): q is RewardQueueView => Boolean(q))
      .map((q) => ({ ...q, pinned: q.id === pinnedId }));
  }, [queue, ids, pinnedId]);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = lookupName.trim();
    if (!name) return;
    setLookingUp(true);
    try {
      const r = await api.lookupRewards(name);
      if (r.campaigns.length === 0) {
        setFeedback({ type: "error", message: `${name} has no active watch-time badge drop.` });
      } else {
        setCampaigns((prev) => {
          const map = new Map(prev.map((c) => [c.id, c]));
          for (const c of r.campaigns) map.set(c.id, c);
          return [...map.values()];
        });
        setTab("channel");
        setFilter(name);
      }
    } catch (err) {
      setFeedback({ type: "error", message: err instanceof Error ? err.message : "Lookup failed" });
    } finally {
      setLookingUp(false);
    }
  };

  const counts = useMemo(
    () => ({
      category: campaigns.filter((c) => c.kind === "category").length,
      channel: campaigns.filter((c) => c.kind === "channel").length,
    }),
    [campaigns]
  );

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return campaigns
      .filter((c) => c.kind === tab)
      .filter(
        (c) =>
          !q ||
          [
            c.name,
            c.channel?.login,
            c.channel?.displayName,
            c.channel?.gameName,
            ...c.categoryNames,
            ...c.groups.flatMap((g) => [g.name, ...g.rewards.map((r) => r.name)]),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q)
      )
      .sort(
        (a, b) =>
          Number(b.channel?.live ?? 0) - Number(a.channel?.live ?? 0) ||
          (b.channel?.viewers ?? 0) - (a.channel?.viewers ?? 0) ||
          Date.parse(a.endsAt) - Date.parse(b.endsAt)
      );
  }, [campaigns, filter, tab]);

  const scanHint = scan?.scanning
    ? "Scanning Twitch for rewards…"
    : scan?.lastScanAt
      ? `Updated ${new Date(scan.lastScanAt).toLocaleTimeString()} · creator badges from the top ${scan.scannedStreams.toLocaleString()} live streams`
      : "Waiting for first scan…";

  return (
    <DashboardPage className="gap-4 lg:gap-3">
      <div className="shrink-0 space-y-3">
        <PageHeader
          eyebrow={
            <>
              <Gift className="h-3.5 w-3.5" />
              Beyond game drops
            </>
          }
          title="Rewards"
          description="Reward campaigns and creator badges. Queued rewards are mined whenever no game drop is being mined; a pinned reward is mined first, ahead of game drops."
          actions={
            <Button variant="outline" size="sm" className="max-sm:flex-1" onClick={load} loading={loading}>
              {!loading && <RefreshCw className="h-4 w-4" />}
              Refresh
            </Button>
          }
        />
        {feedback && (
          <Alert tone={feedback.type === "error" ? "danger" : "success"} title={feedback.message} />
        )}
      </div>

      <DashboardScrollArea className="pb-2 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <div className="grid gap-4 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_24rem] lg:grid-rows-[minmax(0,1fr)] lg:gap-3">
          <Card className="order-2 flex min-h-0 flex-col overflow-hidden lg:order-1">
            <CardHeader className="shrink-0 gap-3 border-b border-white/[0.05] pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                  {(
                    [
                      ["category", "Reward campaigns", Gift],
                      ["channel", "Creator badges", Award],
                    ] as const
                  ).map(([kind, label, Icon]) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setTab(kind)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                        tab === kind
                          ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/25"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className={cn("h-4 w-4", tab === kind && "text-primary")} />
                      {label}
                      <span className="tabular-nums text-2xs text-muted-foreground">{counts[kind]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-2xs text-muted-foreground">
                {tab === "category"
                  ? "Global campaigns without a game — watch time counts on any channel in the listed categories."
                  : "Channel-owned badge drops — watch time counts only on that channel."}{" "}
                {scanHint}
              </p>
              <div className={cn("grid gap-2", tab === "channel" && "sm:grid-cols-2")}>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={tab === "channel" ? "Filter by channel, badge or game" : "Filter by name or category"}
                    className="h-10 pl-9"
                  />
                </div>
                {tab === "channel" && (
                  <form onSubmit={lookup} className="flex gap-2">
                    <Input
                      value={lookupName}
                      onChange={(e) => setLookupName(e.target.value)}
                      placeholder="Check a channel"
                      className="h-10"
                    />
                    <Button type="submit" variant="secondary" size="sm" className="h-10" loading={lookingUp}>
                      Check
                    </Button>
                  </form>
                )}
              </div>
            </CardHeader>
            <CardContent className="scroll-slim space-y-3 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {visible.length === 0 && (
                <EmptyState
                  compact
                  icon={tab === "category" ? Gift : Award}
                  title={scan?.scanning || !scan?.lastScanAt ? "Scanning…" : "Nothing found"}
                  description={
                    filter
                      ? tab === "channel"
                        ? "Nothing matches the filter. Use “Check a channel” for channels outside the top streams."
                        : "Nothing matches the filter."
                      : tab === "channel"
                        ? "Active badge drops of live channels show up here."
                        : "No reward campaign is running right now."
                  }
                />
              )}
              {visible.map((c) => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  queuedIds={queuedIds}
                  pinnedId={pinnedId}
                  saving={saving}
                  onQueue={addToQueue}
                  onPin={togglePin}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="order-1 flex min-h-0 flex-col overflow-hidden lg:order-2">
            <CardHeader className="shrink-0 gap-1.5 border-b border-white/[0.05] pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm">Your reward queue</CardTitle>
                <Badge variant={ids.length ? "primary" : "neutral"}>{ids.length}</Badge>
              </div>
              <p className="text-2xs text-muted-foreground">
                Mined top to bottom · earned rewards are claimed and removed
              </p>
            </CardHeader>
            <CardContent className="scroll-slim space-y-2 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {queueRows.length === 0 && ids.length === 0 && (
                <EmptyState
                  compact
                  icon={ListPlus}
                  title="Queue is empty"
                  description="Queue rewards from the list to mine them when no game drop is running."
                />
              )}
              {queueRows.map((q, i) => (
                <QueueRow
                  key={q.id}
                  item={q}
                  first={i === 0}
                  last={i === queueRows.length - 1}
                  busy={saving === q.id}
                  onPin={() => togglePin(q.id)}
                  onUp={() => move(q.id, -1)}
                  onDown={() => move(q.id, 1)}
                  onRemove={() => removeFromQueue(q.id)}
                  onPickChannel={(channel) => pickChannel(q.id, channel)}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}

function TypeChips({ types, className }: { types: string[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {types.map((t) => (
        <Badge key={t} variant={t === "CHEST" ? "warning" : t === "BADGE" ? "primary" : "info"}>
          {rewardTypeLabel(t)}
        </Badge>
      ))}
    </div>
  );
}

function RewardArt({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <TwitchImage
      src={src}
      alt={alt}
      className={cn(
        "h-10 w-10 shrink-0 rounded-lg bg-white/[0.04] object-contain p-1 ring-1 ring-inset ring-white/10",
        className
      )}
      fallbackClassName={cn("h-10 w-10 shrink-0 rounded-lg bg-white/[0.05]", className)}
    />
  );
}

function CampaignCard({
  campaign,
  queuedIds,
  pinnedId,
  saving,
  onQueue,
  onPin,
}: {
  campaign: RewardCampaign;
  queuedIds: Set<string>;
  pinnedId: string | null;
  saving: string | null;
  onQueue: (id: string) => void;
  onPin: (id: string) => void;
}) {
  const ch = campaign.channel;
  const cats = campaign.categoryNames;
  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center gap-3 border-b border-white/[0.05] bg-white/[0.015] p-3">
        <TwitchImage
          src={ch ? ch.imageUrl : campaign.imageUrl}
          alt={ch ? ch.displayName : campaign.name}
          className={cn("h-10 w-10 shrink-0 object-cover ring-1 ring-inset ring-white/10", ch ? "rounded-full" : "rounded-lg")}
          fallbackClassName={cn("h-10 w-10 shrink-0 bg-white/[0.05]", ch ? "rounded-full" : "rounded-lg")}
        />
        <div className="min-w-0 flex-1">
          {ch ? (
            <>
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium leading-snug">
                <StatusDot tone={ch.live ? "live" : "stopped"} pulse={false} />
                <a
                  href={`https://www.twitch.tv/${ch.login}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate hover:underline"
                >
                  {ch.displayName || ch.login}
                </a>
              </p>
              <p className="truncate text-2xs text-muted-foreground">
                {ch.live ? `${ch.viewers.toLocaleString()} viewers${ch.gameName ? ` · ${ch.gameName}` : ""}` : "Offline"}
                {campaign.endsAt && ` · ${formatEndsIn(campaign.endsAt)}`}
              </p>
            </>
          ) : (
            <>
              <p className="truncate text-sm font-medium leading-snug" title={campaign.name}>
                {campaign.name}
              </p>
              <p className="truncate text-2xs text-muted-foreground" title={cats.join(", ")}>
                {cats.length === 0
                  ? "Any category"
                  : cats.length > 3
                    ? `${cats.slice(0, 3).join(", ")} +${cats.length - 3} more`
                    : cats.join(", ")}
                {campaign.endsAt && ` · ${formatEndsIn(campaign.endsAt)}`}
              </p>
            </>
          )}
        </div>
        {campaign.detailsUrl && (
          <a
            href={campaign.detailsUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Campaign details"
            className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
      <div className="divide-y divide-white/[0.04]">
        {campaign.groups.map((g) => (
          <GroupRow
            key={g.id}
            group={g}
            queued={queuedIds.has(g.id)}
            pinned={pinnedId === g.id}
            busy={saving === g.id}
            onQueue={() => onQueue(g.id)}
            onPin={() => onPin(g.id)}
          />
        ))}
      </div>
    </div>
  );
}

function GroupRow({
  group,
  queued,
  pinned,
  busy,
  onQueue,
  onPin,
}: {
  group: RewardGroupInfo;
  queued: boolean;
  pinned: boolean;
  busy: boolean;
  onQueue: () => void;
  onPin: () => void;
}) {
  const main = group.rewards[0];
  const pool = group.rewards.flatMap((r) => r.pool);
  const title = main?.name || group.name;
  const art = pool.length > 1 ? pool.slice(0, 4) : null;
  return (
    <div className={cn("flex flex-col gap-2.5 p-3 sm:flex-row sm:items-center", !group.mineable && "opacity-60")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {art ? (
          <div className="grid h-10 w-10 shrink-0 grid-cols-2 gap-0.5 rounded-lg bg-white/[0.04] p-0.5 ring-1 ring-inset ring-white/10">
            {art.map((p, i) => (
              <TwitchImage key={i} src={p.imageUrl} alt={p.name} className="h-full w-full object-contain" />
            ))}
          </div>
        ) : (
          <RewardArt src={rewardImage(main)} alt={title} />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-sm font-medium leading-snug" title={pool.length ? pool.map((p) => p.name).join(", ") : title}>
            {title}
            {group.name && group.name !== title && (
              <span className="font-normal text-muted-foreground"> · {group.name}</span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <TypeChips types={groupRewardTypes(group.rewards)} />
            <span className="text-2xs text-muted-foreground">{requirementText(group)}</span>
          </div>
        </div>
      </div>
      {group.mineable ? (
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant={queued ? "success" : "secondary"}
            className="max-sm:flex-1"
            disabled={queued || busy}
            loading={busy && !queued}
            onClick={onQueue}
          >
            {queued ? <Check className="h-4 w-4" /> : !busy && <ListPlus className="h-4 w-4" />}
            {queued ? "Queued" : "Queue"}
          </Button>
          <Button
            size="sm"
            variant={pinned ? "accent" : "outline"}
            className="max-sm:flex-1"
            disabled={busy}
            onClick={onPin}
            title={pinned ? "Unpin" : "Pin — mine before game drops"}
          >
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {pinned ? "Pinned" : "Pin"}
          </Button>
        </div>
      ) : (
        <Badge variant="outline" className="shrink-0 self-start sm:self-center">
          Can't be mined
        </Badge>
      )}
    </div>
  );
}

function QueueRow({
  item,
  first,
  last,
  busy,
  onPin,
  onUp,
  onDown,
  onRemove,
  onPickChannel,
}: {
  item: RewardQueueView;
  first: boolean;
  last: boolean;
  busy: boolean;
  onPin: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onPickChannel: (channel: string | null) => void;
}) {
  const pct = item.requiredMinutes > 0 ? (item.currentMinutes / item.requiredMinutes) * 100 : 0;
  const where =
    item.kind === "channel"
      ? item.channelDisplayName || item.channelLogin
      : item.state === "mining" && item.watchingChannel
        ? `${item.campaignName} · on ${item.watchingChannel}`
        : item.campaignName;
  return (
    <div
      className={cn(
        "space-y-2.5 rounded-xl border p-3",
        item.state === "mining"
          ? "border-primary/35 bg-primary/[0.07]"
          : item.pinned
            ? "border-primary/20 bg-white/[0.02]"
            : "border-white/[0.06] bg-white/[0.02]"
      )}
    >
      <div className="flex items-start gap-3">
        <RewardArt src={item.rewardImageUrl} alt={item.rewardName} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {item.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-primary" />}
            <p className="truncate text-sm font-medium leading-snug" title={item.rewardName}>
              {item.rewardName}
            </p>
          </div>
          <p className="truncate text-2xs text-muted-foreground" title={where}>
            {where}
          </p>
        </div>
        <Badge
          variant={stateVariant[item.state]}
          className="shrink-0"
          title={item.twitchStatus ? `Twitch status: ${item.twitchStatus}` : undefined}
        >
          {item.alongside ? "Mining · parallel" : stateLabel[item.state]}
        </Badge>
      </div>

      <TypeChips types={item.rewardTypes} />

      {item.kind === "category" && (
        <ChannelPicker
          rewardId={item.id}
          value={item.preferredChannel ?? null}
          watching={item.state === "mining" ? item.watchingChannel : null}
          disabled={busy}
          onChange={onPickChannel}
        />
      )}

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2 text-2xs tabular-nums text-muted-foreground">
          <span>
            {item.currentMinutes}/{item.requiredMinutes} min
            {item.repeatTimes ? ` · earned ${item.grantCount}/${item.repeatTimes}` : ""}
          </span>
          <span className="truncate">
            {item.state === "paused" && item.resumeAt
              ? `again ${new Date(item.resumeAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
              : item.state === "paused" && item.repeatTimes
                ? "next round pending"
                : item.state === "locked"
                  ? `locked by Twitch (${item.twitchStatus ?? "unknown"})`
                : item.endsAt
                ? formatEndsIn(item.endsAt)
                : ""}
          </span>
        </div>
        <Progress value={pct} className="h-1.5" tone={item.state === "mining" ? "brand" : "muted"} />
      </div>

      <div className="flex gap-1.5">
        <Button size="xs" variant={item.pinned ? "accent" : "outline"} className="flex-1" disabled={busy} onClick={onPin}>
          {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          {item.pinned ? "Unpin" : "Pin"}
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={busy || first} onClick={onUp}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={busy || last} onClick={onDown}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label="Remove" disabled={busy} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Channel choice for a reward campaign: automatic or one live channel in its categories. */
function ChannelPicker({
  rewardId,
  value,
  watching,
  disabled,
  onChange,
}: {
  rewardId: string;
  value: string | null;
  watching: string | null;
  disabled: boolean;
  onChange: (channel: string | null) => void;
}) {
  const [channels, setChannels] = useState<CategoryChannel[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const r = await api.rewardChannels(rewardId);
      setChannels(r.channels);
    } catch {
      setChannels((prev) => prev ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewardId]);

  const list = channels ?? [];
  const pickedMissing = value && !list.some((c) => c.login.toLowerCase() === value.toLowerCase());
  const fallback = value && watching && watching.toLowerCase() !== value.toLowerCase();

  return (
    <div className="space-y-1">
      <Select
        aria-label="Channel"
        className="h-9 text-xs"
        value={value ?? "__auto__"}
        disabled={disabled}
        onFocus={() => void load()}
        onChange={(e) => onChange(e.target.value === "__auto__" ? null : e.target.value)}
      >
        <option value="__auto__">Channel: auto (most viewers)</option>
        {pickedMissing && <option value={value!}>{value} (not live in this category)</option>}
        {list.map((c) => (
          <option key={c.login} value={c.login}>
            {c.displayName} · {c.viewers.toLocaleString()} viewers{c.gameName ? ` · ${c.gameName}` : ""}
          </option>
        ))}
        {channels === null && <option disabled>Loading channels…</option>}
      </Select>
      {fallback && (
        <p className="text-2xs text-warning">
          {value} can't be watched right now — using {watching} until it is back
        </p>
      )}
    </div>
  );
}
