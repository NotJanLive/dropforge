import type { RewardGroupInfo, RewardItem } from "@/lib/api";

export function formatWatchTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatEndsIn(endsAt: string): string {
  const ms = Date.parse(endsAt) - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "ended";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `ends in ${Math.floor(h / 24)} d`;
  if (h >= 1) return `ends in ${h} h`;
  return `ends in ${Math.max(1, Math.floor(ms / 60_000))} min`;
}

const typeLabels: Record<string, string> = {
  BADGE: "Badge",
  EMOTE: "Emote",
  CHEST: "Chest",
  POOL: "Chest",
  DIRECT_ENTITLEMENT: "Game item",
  CODE: "Code",
};

export function rewardTypeLabel(type: string): string {
  return (
    typeLabels[type] ??
    type
      .toLowerCase()
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/** Distinct reward types of a group; chests list what they can contain. */
export function groupRewardTypes(rewards: RewardItem[]): string[] {
  const types = new Set<string>();
  for (const r of rewards) {
    if (r.type === "POOL") {
      types.add("CHEST");
      for (const p of r.pool) types.add(p.type);
    } else {
      types.add(r.type);
    }
  }
  return [...types];
}

/** Chests show a placeholder image — show what is inside instead. */
export function rewardImage(r: RewardItem | undefined): string {
  if (!r) return "";
  if (r.pool.length > 0 && (!r.imageUrl || r.imageUrl.endsWith("/default.png"))) return r.pool[0].imageUrl;
  return r.imageUrl;
}

function resetText(seconds: number | null): string {
  if (!seconds) return "";
  if (seconds % 86_400 === 0) return seconds === 86_400 ? "once a day" : `every ${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return seconds === 3_600 ? "once an hour" : `every ${seconds / 3_600} h`;
  return `every ${Math.round(seconds / 60)} min`;
}

export function requirementText(g: RewardGroupInfo): string {
  if (g.requirementType === "WATCH") {
    let text = `Watch ${formatWatchTime(g.minutesWatched)}`;
    if (g.repeatTimes) {
      const daily = g.resetSeconds === 86_400;
      const every = daily ? "" : resetText(g.resetSeconds);
      text += g.completeAllRepeats
        ? daily
          ? ` · ${g.repeatTimes} days, all needed`
          : ` · ${g.repeatTimes}×${every ? ` (${every})` : ""}, all needed`
        : ` · up to ${g.repeatTimes}×${daily ? ", daily" : every ? ` (${every})` : ""}`;
    }
    return text;
  }
  if (g.requirementType === "SUB") return `Gift or buy ${g.subs} sub${g.subs === 1 ? "" : "s"}`;
  return g.requirementType || "Special requirement";
}
