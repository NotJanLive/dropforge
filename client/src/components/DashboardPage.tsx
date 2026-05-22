import { cn } from "@/lib/utils";

/** Fills the dashboard main pane — no page-level scroll. */
export function DashboardPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex h-full min-h-0 min-w-0 flex-col overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function DashboardPageHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("mb-4 shrink-0 space-y-4", className)}>{children}</div>;
}

/** Primary scroll region below a fixed header/toolbar. */
export function DashboardScrollArea({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-1", className)}>
      {children}
    </div>
  );
}
