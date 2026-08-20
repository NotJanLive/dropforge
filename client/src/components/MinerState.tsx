import { cn } from "@/lib/utils";

export type MinerStateTone = "live" | "idle" | "error" | "stopped" | "neutral";

export function minerStateTone(state: string | undefined | null): MinerStateTone {
  switch ((state ?? "").toUpperCase()) {
    case "WATCHING":
      return "live";
    case "IDLE":
      return "idle";
    case "ERROR":
      return "error";
    case "STOPPED":
      return "stopped";
    default:
      return "neutral";
  }
}

const dotTone: Record<MinerStateTone, string> = {
  live: "bg-success",
  idle: "bg-warning",
  error: "bg-danger",
  stopped: "bg-muted-foreground",
  neutral: "bg-primary",
};

const pillTone: Record<MinerStateTone, string> = {
  live: "border-success/30 bg-success/10 text-success",
  idle: "border-warning/30 bg-warning/10 text-warning",
  error: "border-danger/30 bg-danger/10 text-danger",
  stopped: "border-white/[0.08] bg-white/[0.04] text-muted-foreground",
  neutral: "border-primary/30 bg-primary/10 text-primary",
};

/** Small dot; pulses while live. */
export function StatusDot({
  tone,
  className,
  pulse,
}: {
  tone: MinerStateTone;
  className?: string;
  pulse?: boolean;
}) {
  const animated = pulse ?? tone === "live";
  return (
    <span className={cn("relative flex h-2 w-2 shrink-0", className)}>
      {animated && (
        <span
          className={cn("absolute inset-0 rounded-full animate-pulse-ring", dotTone[tone])}
          aria-hidden
        />
      )}
      <span className={cn("relative h-2 w-2 rounded-full", dotTone[tone])} />
    </span>
  );
}

export function StatePill({
  state,
  className,
  size = "sm",
}: {
  state: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const tone = minerStateTone(state);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-micro",
        size === "sm" ? "px-2 py-1 text-2xs" : "px-2.5 py-1 text-xs",
        pillTone[tone],
        className
      )}
    >
      <StatusDot tone={tone} />
      {state || "—"}
    </span>
  );
}
