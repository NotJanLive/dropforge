import { cn } from "@/lib/utils";

/** Fills the dashboard main pane — scrolls on small screens when content overflows. */
export function DashboardPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        "max-lg:overflow-x-hidden max-lg:overflow-y-auto max-lg:dashboard-scroll",
        "lg:h-full lg:overflow-hidden",
        className
      )}
    >
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
    <div
      className={cn(
        "min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1 dashboard-scroll",
        className
      )}
    >
      {children}
    </div>
  );
}
