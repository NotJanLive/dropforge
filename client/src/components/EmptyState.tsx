import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className
      )}
    >
      {Icon && (
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.04] text-muted-foreground ring-1 ring-inset ring-white/[0.06]">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <div className="space-y-1">
        <p className={cn("font-medium tracking-tight", compact ? "text-sm" : "text-base")}>{title}</p>
        {description && (
          <div className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      {action}
    </div>
  );
}
