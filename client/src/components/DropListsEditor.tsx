import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Ban, ListOrdered, Plus, Settings2, X } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TwitchImage } from "@/components/TwitchImage";
import { gamesAvailableForAdd, type GameOption } from "@/lib/campaignGames";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { cn } from "@/lib/utils";

interface DropListsEditorProps {
  games: GameOption[];
  priorityGames: string[];
  excludeGames: string[];
  priorityMode: string;
  onPriorityGamesChange: (games: string[]) => void;
  onExcludeGamesChange: (games: string[]) => void;
  onPriorityModeChange: (mode: string) => void;
  activeOnlyHint?: boolean;
  hidePriorityMode?: boolean;
}

function GameArt({ imageUrl, name }: { imageUrl?: string; name: string }) {
  return (
    <TwitchImage
      src={resolveGameImageUrl({ gameImageUrl: imageUrl, gameName: name })}
      fallbackSrc=""
      alt=""
      className="h-10 w-[1.875rem] shrink-0 rounded-md object-cover ring-1 ring-inset ring-white/10"
      fallbackClassName="h-10 w-[1.875rem] shrink-0 rounded-md bg-white/[0.05]"
    />
  );
}

function ListCard({
  icon: Icon,
  title,
  description,
  count,
  children,
  tone = "neutral",
}: {
  icon: typeof ListOrdered;
  title: string;
  description: string;
  count: number;
  children: React.ReactNode;
  tone?: "primary" | "neutral";
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="gap-1.5 pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Icon
              className={cn("h-4 w-4", tone === "primary" ? "text-primary" : "text-muted-foreground")}
            />
            {title}
          </CardTitle>
          <span className="text-2xs tabular-nums text-muted-foreground">{count}</span>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-2 pt-0">{children}</CardContent>
    </Card>
  );
}

export function DropListsEditor({
  games,
  priorityGames,
  excludeGames,
  priorityMode,
  onPriorityGamesChange,
  onExcludeGamesChange,
  onPriorityModeChange,
  activeOnlyHint = false,
  hidePriorityMode = false,
}: DropListsEditorProps) {
  const [pickGame, setPickGame] = useState("");
  const [addTarget, setAddTarget] = useState<"priority" | "exclude">("priority");

  const addable = useMemo(
    () => gamesAvailableForAdd(games, priorityGames, excludeGames),
    [games, priorityGames, excludeGames]
  );

  const addGame = () => {
    const name = pickGame.trim();
    if (!name) return;
    if (addTarget === "priority") {
      if (!priorityGames.includes(name)) {
        onPriorityGamesChange([...priorityGames, name]);
      }
      onExcludeGamesChange(excludeGames.filter((g) => g !== name));
    } else {
      if (!excludeGames.includes(name)) {
        onExcludeGamesChange([...excludeGames, name]);
      }
      onPriorityGamesChange(priorityGames.filter((g) => g !== name));
    }
    setPickGame("");
  };

  const movePriority = (index: number, dir: -1 | 1) => {
    const next = [...priorityGames];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onPriorityGamesChange(next);
  };

  const metaFor = (name: string) => games.find((g) => g.name === name);

  return (
    <div className="grid gap-3.5 lg:grid-cols-3">
      <Card className="flex flex-col">
        <CardHeader className="gap-1.5 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            Configure
          </CardTitle>
          <CardDescription className="text-xs">
            {activeOnlyHint
              ? "Add active games with drop campaigns. The miner walks the priority list top to bottom."
              : "Choose games to prioritize or exclude."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {!hidePriorityMode && (
            <div className="space-y-2">
              <Label htmlFor="priority-mode">Priority mode</Label>
              <Select
                id="priority-mode"
                value={priorityMode}
                onChange={(e) => onPriorityModeChange(e.target.value)}
              >
                <option value="PRIORITY_ONLY">Priority list only</option>
                <option value="ENDING_SOONEST">Priority first, then ending soonest</option>
                <option value="LOW_AVBL_FIRST">Priority first, then low availability</option>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="add-game">Add game</Label>
            <Select id="add-game" value={pickGame} onChange={(e) => setPickGame(e.target.value)}>
              <option value="">Select a game…</option>
              {addable.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name} ({g.campaignCount} campaign{g.campaignCount === 1 ? "" : "s"})
                  {!g.linked ? " · link required" : ""}
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1">
              {(
                [
                  { key: "priority", label: "To priority" },
                  { key: "exclude", label: "To ignore" },
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAddTarget(key)}
                  aria-pressed={addTarget === key}
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200",
                    addTarget === key
                      ? key === "priority"
                        ? "bg-primary/15 text-primary"
                        : "bg-white/[0.08] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <Button type="button" className="w-full" disabled={!pickGame} onClick={addGame}>
              <Plus className="h-4 w-4" />
              Add game
            </Button>
          </div>
        </CardContent>
      </Card>

      <ListCard
        icon={ListOrdered}
        tone="primary"
        title="Priority list"
        description="Games are mined from top to bottom"
        count={priorityGames.length}
      >
        {priorityGames.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-center text-xs leading-relaxed text-muted-foreground">
            {priorityMode === "PRIORITY_ONLY"
              ? "Empty — miner stays idle until you add games."
              : "Empty — miner uses all non-ignored games."}
          </p>
        )}

        {priorityGames.map((game, index) => {
          const meta = metaFor(game);
          return (
            <div
              key={game}
              className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] p-2"
            >
              <span className="w-4 shrink-0 text-center text-2xs font-semibold tabular-nums text-primary">
                {index + 1}
              </span>
              <GameArt imageUrl={meta?.imageUrl} name={game} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{game}</span>
              <div className="flex shrink-0 items-center">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={index === 0}
                  aria-label={`Move ${game} up`}
                  onClick={() => movePriority(index, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={index === priorityGames.length - 1}
                  aria-label={`Move ${game} down`}
                  onClick={() => movePriority(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${game}`}
                  onClick={() => onPriorityGamesChange(priorityGames.filter((g) => g !== game))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </ListCard>

      <ListCard
        icon={Ban}
        title="Ignore list"
        description="Excluded games are never selected for mining"
        count={excludeGames.length}
      >
        {excludeGames.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/[0.08] px-3 py-4 text-center text-xs text-muted-foreground">
            No ignored games.
          </p>
        )}

        {excludeGames.map((game) => {
          const meta = metaFor(game);
          return (
            <div
              key={game}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2"
            >
              <GameArt imageUrl={meta?.imageUrl} name={game} />
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{game}</span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${game}`}
                onClick={() => onExcludeGamesChange(excludeGames.filter((g) => g !== game))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </ListCard>
    </div>
  );
}

export function ActionFeedback({
  feedback,
  className,
}: {
  feedback: { type: "success" | "error"; message: string } | null;
  className?: string;
}) {
  if (!feedback) return null;
  return (
    <Alert
      tone={feedback.type === "success" ? "success" : "danger"}
      className={cn("py-3", className)}
      role="status"
    >
      {feedback.message}
    </Alert>
  );
}
