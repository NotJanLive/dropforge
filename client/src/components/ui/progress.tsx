import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

type ProgressTone = "brand" | "success" | "warning" | "muted";

const toneClasses: Record<ProgressTone, string> = {
  brand: "bg-primary shadow-[0_0_12px_-2px_hsl(var(--primary)/0.7)]",
  success: "bg-success shadow-[0_0_12px_-2px_hsl(var(--success)/0.7)]",
  warning: "bg-warning shadow-[0_0_12px_-2px_hsl(var(--warning)/0.7)]",
  muted: "bg-muted-foreground/60",
};

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
    tone?: ProgressTone;
    indicatorClassName?: string;
  }
>(({ className, value, tone = "brand", indicatorClassName, ...props }, ref) => {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={pct}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full border border-white/[0.05] bg-white/[0.05]",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-spring",
          toneClasses[tone],
          indicatorClassName
        )}
        style={{ width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
