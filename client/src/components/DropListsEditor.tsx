import { ArrowDown, ArrowUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { gamesAvailableForAdd, type GameOption } from "@/lib/campaignGames";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

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
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">Settings</CardTitle>
          <CardDescription>
            {activeOnlyHint
              ? "Add active games with drop campaigns. The miner walks the priority list top to bottom."
              : "Choose games to prioritize or exclude. All eligible campaigns for selected games are considered."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hidePriorityMode && (
            <div className="space-y-2">
              <Label>Priority mode</Label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm"
                value={priorityMode}
                onChange={(e) => onPriorityModeChange(e.target.value)}
              >
                <option value="PRIORITY_ONLY">Priority list only</option>
                <option value="ENDING_SOONEST">Priority first, then ending soonest</option>
                <option value="LOW_AVBL_FIRST">Priority first, then low availability</option>
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Add game</Label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm"
              value={pickGame}
              onChange={(e) => setPickGame(e.target.value)}
            >
              <option value="">Select a game…</option>
              {addable.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name} ({g.campaignCount} campaign{g.campaignCount === 1 ? "" : "s"})
                  {!g.linked ? " · link required" : ""}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={addTarget === "priority" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAddTarget("priority")}
              >
                To priority
              </Button>
              <Button
                type="button"
                size="sm"
                variant={addTarget === "exclude" ? "default" : "outline"}
                className="flex-1"
                onClick={() => setAddTarget("exclude")}
              >
                To ignore
              </Button>
            </div>
            <Button type="button" className="w-full min-h-10" size="sm" disabled={!pickGame} onClick={addGame}>
              Add game
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Priority list</CardTitle>
          <CardDescription>Games are mined from top to bottom</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 min-h-[8rem]">
          {priorityGames.length === 0 && (
            <p className="text-sm text-muted-foreground">
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
                className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2"
              >
                {meta?.imageUrl ? (
                  <img
                    src={resolveGameImageUrl({ gameImageUrl: meta.imageUrl, gameName: game })}
                    alt=""
                    className="h-10 w-8 rounded object-cover shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-10 w-8 rounded bg-muted shrink-0" />
                )}
                <span className="text-sm flex-1 truncate font-medium">{game}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={index === 0}
                  onClick={() => movePriority(index, -1)}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={index === priorityGames.length - 1}
                  onClick={() => movePriority(index, 1)}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => onPriorityGamesChange(priorityGames.filter((g) => g !== game))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ignore list</CardTitle>
          <CardDescription>Excluded games are never selected for mining</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 min-h-[8rem]">
          {excludeGames.length === 0 && (
            <p className="text-sm text-muted-foreground">No ignored games.</p>
          )}
          {excludeGames.map((game) => {
            const meta = metaFor(game);
            return (
              <div
                key={game}
                className="flex items-center gap-2 rounded-lg border border-border/60 p-2"
              >
                {meta?.imageUrl ? (
                  <img
                    src={resolveGameImageUrl({ gameImageUrl: meta.imageUrl, gameName: game })}
                    alt=""
                    className="h-10 w-8 rounded object-cover shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="h-10 w-8 rounded bg-muted shrink-0" />
                )}
                <span className="text-sm flex-1 truncate">{game}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={() => onExcludeGamesChange(excludeGames.filter((g) => g !== game))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
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
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-sm",
        feedback.type === "success" &&
          "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        feedback.type === "error" && "border-red-500/40 bg-red-500/10 text-red-300",
        className
      )}
      role="status"
    >
      {feedback.message}
    </div>
  );
}
