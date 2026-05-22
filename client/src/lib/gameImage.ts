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

function boxArtUrl(slugOrId: string): string {
  return `https://static-cdn.jtvnw.net/ttv-boxart/${slugOrId}-285x380.jpg`;
}

/** Prefer server-provided URL; only synthesize when missing. */
export function resolveGameImageUrl(input: {
  gameImageUrl?: string;
  gameName?: string;
  gameSlug?: string;
}): string {
  const existing = input.gameImageUrl?.trim();
  if (existing) return existing;

  const slug = input.gameSlug?.trim();
  if (slug) return boxArtUrl(slug);

  const name = input.gameName?.trim();
  if (name) {
    const fromName = slugifyGameName(name);
    if (fromName) return boxArtUrl(fromName);
  }

  return "";
}

export function dropImageUrl(
  drop: { imageUrl?: string },
  campaign: { gameImageUrl?: string; gameName?: string; gameSlug?: string }
): string {
  return drop.imageUrl?.trim() || resolveGameImageUrl(campaign);
}
