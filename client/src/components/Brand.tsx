import { cn } from "@/lib/utils";

/** Dropforge mark — an anvil silhouette on the brand tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // Radius is ~0.3 of the tile size so the mark stays a squircle at every
        // size — the theme's rounded-2xl (20px) would round a 44px tile into a
        // circle. The ring lives on this element so it follows that radius.
        "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem]",
        "bg-primary-strong shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.95)]",
        "ring-1 ring-inset ring-white/20",
        className
      )}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-[58%] w-[58%] text-white" aria-hidden>
        <path d="M2.6 7.2h18.8c.4 0 .7.35.66.75-.2 2.2-1.75 3.75-4.06 3.75h-2.1c-.6 0-1.1.5-1.1 1.1v2.2h1.9c.83 0 1.5.67 1.5 1.5v1.6c0 .38-.3.7-.68.7H6.48a.7.7 0 0 1-.68-.7v-1.6c0-.83.67-1.5 1.5-1.5h1.9V12.8c0-.6-.5-1.1-1.1-1.1h-1.4c-1.9 0-3.05-.9-3.72-2.3L2.6 7.2Z" />
      </svg>
    </span>
  );
}

export function BrandLockup({
  subtitle,
  className,
  markClassName,
}: {
  subtitle?: string;
  className?: string;
  markClassName?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <BrandMark className={markClassName} />
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[0.95rem] font-semibold tracking-tight">Dropforge</p>
        {subtitle && (
          <p className="truncate text-2xs uppercase tracking-micro text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
