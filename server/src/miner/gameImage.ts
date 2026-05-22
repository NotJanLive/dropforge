function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

const BOXART_SIZE = "285x380";

export function boxArtUrl(slugOrId: string): string {
  return `https://static-cdn.jtvnw.net/ttv-boxart/${slugOrId}-${BOXART_SIZE}.jpg`;
}

export function slugifyGameName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Merge campaign + list payload game objects (keep box art from either). */
export function mergeGameRecords(
  primary?: unknown,
  fallback?: unknown
): Record<string, unknown> {
  const a = asRecord(primary);
  const b = asRecord(fallback);
  const boxArtURL = a.boxArtURL ?? a.boxArtUrl ?? b.boxArtURL ?? b.boxArtUrl ?? "";
  return {
    ...b,
    ...a,
    boxArtURL,
    boxArtUrl: boxArtURL,
    id: a.id ?? b.id ?? "",
    slug: a.slug ?? b.slug ?? "",
    name: a.name ?? a.displayName ?? b.name ?? b.displayName ?? "",
    displayName: a.displayName ?? a.name ?? b.displayName ?? b.name ?? "",
  };
}

export function resolveGameImageUrl(input: {
  game?: unknown;
  gameName?: string;
  gameSlug?: string;
  gameImageUrl?: string;
}): string {
  if (input.gameImageUrl?.trim()) return input.gameImageUrl.trim();

  const game = mergeGameRecords(input.game, null);
  const url = String(game.boxArtURL ?? game.boxArtUrl ?? "").trim();
  if (url) return url;

  const slug = String(input.gameSlug || game.slug || "").trim();
  if (slug) return boxArtUrl(slug);

  const id = String(game.id ?? "").trim();
  if (id) return boxArtUrl(id);

  const name = String(input.gameName || game.displayName || game.name || "").trim();
  if (name) {
    const fromName = slugifyGameName(name);
    if (fromName) return boxArtUrl(fromName);
  }

  return "";
}

export interface GameImageFields {
  gameName: string;
  gameSlug?: string;
  gameImageUrl: string;
}

/** Fill missing gameImageUrl from slug/name and sibling campaigns with the same game. */
export function enrichGameImages<T extends GameImageFields>(items: T[]): T[] {
  const peerUrl = new Map<string, string>();

  for (const item of items) {
    const key = item.gameName.toLowerCase();
    if (!key) continue;
    const resolved = resolveGameImageUrl(item);
    if (resolved && !peerUrl.has(key)) peerUrl.set(key, resolved);
  }

  return items.map((item) => {
    const key = item.gameName.toLowerCase();
    const url =
      resolveGameImageUrl(item) ||
      (key ? peerUrl.get(key) : undefined) ||
      "";
    return { ...item, gameImageUrl: url };
  });
}

export interface CampaignWithDrops extends GameImageFields {
  drops: Array<{ imageUrl: string; [key: string]: unknown }>;
}

export function enrichCampaignGameImages<T extends CampaignWithDrops>(campaigns: T[]): T[] {
  return enrichGameImages(campaigns).map((c) => ({
    ...c,
    drops: c.drops.map((d) => ({
      ...d,
      imageUrl: d.imageUrl || c.gameImageUrl,
    })),
  }));
}
