export interface CampaignGameSource {
  gameName: string;
  gameImageUrl: string;
  status: string;
  linked: boolean;
}

export interface GameOption {
  name: string;
  imageUrl: string;
  campaignCount: number;
  linked: boolean;
}

export function buildGameOptions(
  campaigns: CampaignGameSource[],
  options: { activeOnly?: boolean } = {}
): GameOption[] {
  const map = new Map<string, GameOption>();
  for (const c of campaigns) {
    if (options.activeOnly && c.status !== "ACTIVE") continue;
    const existing = map.get(c.gameName);
    if (existing) {
      existing.campaignCount += 1;
      existing.linked = existing.linked || c.linked;
      if (!existing.imageUrl && c.gameImageUrl) existing.imageUrl = c.gameImageUrl;
    } else {
      map.set(c.gameName, {
        name: c.gameName,
        imageUrl: c.gameImageUrl,
        campaignCount: 1,
        linked: c.linked,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function gamesAvailableForAdd(
  games: GameOption[],
  priorityGames: string[],
  excludeGames: string[]
): GameOption[] {
  const blocked = new Set([...priorityGames, ...excludeGames]);
  return games.filter((g) => !blocked.has(g.name));
}
