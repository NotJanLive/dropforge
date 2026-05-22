import { useCallback, useEffect, useRef, useState } from "react";

/**
 * TwitchDropsMiner gui.py ProgressBar._divmod — minutes from Twitch, seconds tick within the minute.
 * Resets cleanly when lastWatchAt updates after a credited watch minute.
 */
export function tdmRemainingSeconds(
  remainingMinutes: number,
  lastWatchAt: string | null | undefined,
  nowMs = Date.now()
): number {
  if (remainingMinutes <= 0) return 0;
  if (!lastWatchAt) return remainingMinutes * 60;

  const elapsed = Math.max(0, Math.floor((nowMs - new Date(lastWatchAt).getTime()) / 1000));
  const secInMinute = elapsed % 60;

  if (secInMinute === 0 && elapsed === 0) {
    return remainingMinutes * 60;
  }

  const displayMinutes = secInMinute > 0 ? Math.max(0, remainingMinutes - 1) : remainingMinutes;
  const displaySeconds = secInMinute > 0 ? 60 - secInMinute : 0;
  return displayMinutes * 60 + displaySeconds;
}

export function formatWatchRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function useTdmCountdown(
  remainingMinutes: number,
  lastWatchAt: string | null | undefined,
  resetKey: string
): number {
  const compute = useCallback(
    () => tdmRemainingSeconds(remainingMinutes, lastWatchAt),
    [remainingMinutes, lastWatchAt]
  );

  const [seconds, setSeconds] = useState(compute);

  useEffect(() => {
    setSeconds(compute());
    const id = window.setInterval(() => setSeconds(compute()), 1000);
    return () => window.clearInterval(id);
  }, [compute, resetKey]);

  return seconds;
}

export function useWatchRemainingSeconds(
  currentMinutes: number,
  requiredMinutes: number,
  lastWatchAt: string | null | undefined
): number {
  const remainingMinutes =
    requiredMinutes <= 0 || currentMinutes >= requiredMinutes
      ? 0
      : requiredMinutes - currentMinutes;
  return useTdmCountdown(remainingMinutes, lastWatchAt, `${currentMinutes}/${requiredMinutes}`);
}

export function useWatchRemainingFromMinutes(
  remainingMinutes: number,
  lastWatchAt: string | null | undefined
): number {
  return useTdmCountdown(remainingMinutes, lastWatchAt, String(remainingMinutes));
}

/** Static snapshot for campaign list rows (no live tick). */
export function watchRemainingSecondsFromMinutes(
  remainingMinutes: number,
  lastWatchAt: string | null | undefined,
  nowMs = Date.now()
): number {
  return tdmRemainingSeconds(remainingMinutes, lastWatchAt, nowMs);
}

export interface CampaignProgressView {
  progress: number;
  claimed: number;
  total: number;
  remainingMinutes: number;
}

export function getCampaignProgressView(
  campaign: {
    drops: Array<{
      id: string;
      requiredMinutes: number;
      currentMinutes: number;
      isComplete: boolean;
      isClaimed?: boolean;
      preconditionDropIds?: string[];
    }>;
  },
  activeDropId?: string
): CampaignProgressView {
  const drops = campaign.drops.map((d) => ({
    ...d,
    preconditionDropIds: d.preconditionDropIds ?? [],
  }));
  const total = drops.length;
  const activeIdx = activeDropId ? drops.findIndex((d) => d.id === activeDropId) : -1;

  if (activeIdx >= 0) {
    for (let i = 0; i < activeIdx; i++) {
      const d = drops[i];
      if (d.requiredMinutes > 0) {
        d.currentMinutes = d.requiredMinutes;
        d.isComplete = true;
      }
    }
  }

  const claimedDrops = drops.filter((d) => d.isClaimed).length;

  const progress =
    total > 0
      ? (drops.reduce((sum, d) => {
          if (d.requiredMinutes <= 0) return sum + (d.isClaimed ? 1 : 0);
          const mins = d.isClaimed ? d.requiredMinutes : d.currentMinutes;
          return sum + Math.min(1, mins / d.requiredMinutes);
        }, 0) /
          total) *
        100
      : 0;

  const remainingMinutes = computeCampaignRemainingMinutes(campaign, activeDropId);

  return { progress, claimed: claimedDrops, total, remainingMinutes };
}

function isCumulativeDropChain(
  drops: Array<{ requiredMinutes: number; preconditionDropIds?: string[] }>
): boolean {
  if (drops.some((d) => (d.preconditionDropIds?.length ?? 0) > 0)) return false;
  const timed = drops.filter((d) => d.requiredMinutes > 0);
  if (timed.length <= 1) return true;
  for (let i = 1; i < timed.length; i++) {
    if (timed[i].requiredMinutes <= timed[i - 1].requiredMinutes) return false;
  }
  return true;
}

function watchedCumulativeMinutes(
  drops: Array<{
    id: string;
    requiredMinutes: number;
    currentMinutes: number;
    isClaimed?: boolean;
  }>,
  activeDropId?: string
): number {
  if (activeDropId) {
    const active = drops.find((d) => d.id === activeDropId);
    if (active && active.requiredMinutes > 0) {
      return active.isClaimed ? active.requiredMinutes : active.currentMinutes;
    }
  }

  let watched = 0;
  for (const d of drops) {
    if (d.requiredMinutes <= 0) continue;
    if (d.isClaimed) watched = Math.max(watched, d.requiredMinutes);
    else if (d.currentMinutes > 0) watched = Math.max(watched, d.currentMinutes);
  }
  return watched;
}

function computeCampaignRemainingMinutes(
  campaign: {
    drops: Array<{
      id: string;
      requiredMinutes: number;
      currentMinutes: number;
      isComplete: boolean;
      isClaimed?: boolean;
      preconditionDropIds?: string[];
    }>;
  },
  activeDropId?: string
): number {
  const drops = campaign.drops.map((d) => ({
    ...d,
    preconditionDropIds: d.preconditionDropIds ?? [],
  }));
  if (drops.length === 0) return 0;

  const hasPreconditions = drops.some((d) => d.preconditionDropIds.length > 0);
  if (hasPreconditions) {
    const remainById = new Map<string, number>();
    const totalRemaining = (dropId: string): number => {
      const cached = remainById.get(dropId);
      if (cached !== undefined) return cached;

      const drop = drops.find((d) => d.id === dropId);
      if (!drop || drop.isClaimed) {
        remainById.set(dropId, 0);
        return 0;
      }

      const own =
        drop.requiredMinutes <= 0
          ? 0
          : Math.max(0, drop.requiredMinutes - Math.min(drop.currentMinutes, drop.requiredMinutes));
      const preMax = Math.max(
        0,
        ...drop.preconditionDropIds.map((pid) => totalRemaining(pid))
      );
      const total = own + preMax;
      remainById.set(dropId, total);
      return total;
    };

    let maxRemaining = 0;
    for (const d of drops) {
      if (!d.isClaimed) maxRemaining = Math.max(maxRemaining, totalRemaining(d.id));
    }
    return maxRemaining;
  }

  if (isCumulativeDropChain(drops)) {
    const unclaimedTimed = drops.filter((d) => !d.isClaimed && d.requiredMinutes > 0);
    if (unclaimedTimed.length === 0) return 0;
    const target = Math.max(...unclaimedTimed.map((d) => d.requiredMinutes));
    const watched = watchedCumulativeMinutes(drops, activeDropId);
    return Math.max(0, target - watched);
  }

  return Math.max(
    0,
    drops.reduce((sum, d) => {
      const req = Math.max(0, d.requiredMinutes);
      if (req <= 0 || d.isClaimed) return sum;
      return sum + Math.max(0, req - Math.min(d.currentMinutes, req));
    }, 0)
  );
}
