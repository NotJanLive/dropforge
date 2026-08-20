import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "brand" | "success" | "warning" | "danger" | "neutral";

const toneRing: Record<Tone, string> = {
  brand: "bg-primary/12 text-primary ring-primary/20",
  success: "bg-success/12 text-success ring-success/20",
  warning: "bg-warning/12 text-warning ring-warning/20",
  danger: "bg-danger/12 text-danger ring-danger/20",
  neutral: "bg-white/[0.05] text-muted-foreground ring-white/[0.08]",
};

export function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "brand",
  accessory,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  accessory?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.06] bg-card/60 p-3.5 shadow-panel backdrop-blur-xl sm:p-4 lg:p-3",
        className
      )}
    >
      {Icon && (
        <span
          className={cn(
            "hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset xs:flex",
            toneRing[tone]
          )}
        >
          <Icon className="h-[1.15rem] w-[1.15rem]" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 truncate text-[0.95rem] font-semibold leading-snug tracking-tight">
          {value}
        </p>
        {hint && <p className="mt-0.5 truncate text-2xs text-muted-foreground">{hint}</p>}
      </div>
      {accessory}
    </div>
  );
}

/** Compact number tile used for admin counters. */
export function CountTile({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  className,
}: {
  icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  const valueTone: Record<Tone, string> = {
    brand: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    neutral: "text-foreground",
  };
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-card/60 px-3 py-3 shadow-panel backdrop-blur-xl sm:px-4",
        className
      )}
    >
      {Icon && (
        <span
          className={cn(
            "hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset xs:flex",
            toneRing[tone]
          )}
        >
          <Icon className="h-[1.15rem] w-[1.15rem]" />
        </span>
      )}
      <div className="min-w-0 max-xs:text-center max-xs:w-full">
        <p className="truncate text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
          {label}
        </p>
        <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", valueTone[tone])}>
          {value}
        </p>
      </div>
    </div>
  );
}
