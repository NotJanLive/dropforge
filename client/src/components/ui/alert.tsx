import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type AlertTone = "info" | "success" | "warning" | "danger";

const toneStyles: Record<AlertTone, { wrap: string; icon: string; defaultIcon: LucideIcon }> = {
  info: {
    wrap: "border-info/25 bg-info/[0.07]",
    icon: "text-info",
    defaultIcon: Info,
  },
  success: {
    wrap: "border-success/25 bg-success/[0.07]",
    icon: "text-success",
    defaultIcon: CheckCircle2,
  },
  warning: {
    wrap: "border-warning/25 bg-warning/[0.07]",
    icon: "text-warning",
    defaultIcon: AlertTriangle,
  },
  danger: {
    wrap: "border-danger/25 bg-danger/[0.07]",
    icon: "text-danger",
    defaultIcon: AlertCircle,
  },
};

export function Alert({
  tone = "info",
  icon,
  title,
  children,
  action,
  className,
  role = "status",
}: {
  tone?: AlertTone;
  icon?: LucideIcon | null;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  role?: React.AriaRole;
}) {
  const styles = toneStyles[tone];
  const Icon = icon === null ? null : (icon ?? styles.defaultIcon);

  return (
    <div
      role={role}
      className={cn(
        "flex flex-col gap-3 rounded-2xl border px-4 py-3.5 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        styles.wrap,
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon && <Icon className={cn("mt-0.5 h-[1.1rem] w-[1.1rem] shrink-0", styles.icon)} />}
        <div className="min-w-0 space-y-0.5">
          {title && <p className="text-sm font-semibold leading-snug tracking-tight">{title}</p>}
          {children && (
            <div className="text-sm leading-relaxed text-muted-foreground">{children}</div>
          )}
        </div>
      </div>
      {action && <div className="shrink-0 max-sm:w-full">{action}</div>}
    </div>
  );
}
