import { cn } from "@/lib/utils";

/**
 * Fills the dashboard main pane. Below `lg` the whole page scrolls naturally;
 * from `lg` up the page is height-locked and inner regions scroll instead.
 */
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
        "flex min-h-0 min-w-0 flex-col animate-fade-up",
        "max-lg:dashboard-scroll max-lg:overflow-y-auto max-lg:overflow-x-hidden",
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
  return <div className={cn("mb-5 shrink-0 space-y-4", className)}>{children}</div>;
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
        "dashboard-scroll min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5",
        className
      )}
    >
      {children}
    </div>
  );
}
