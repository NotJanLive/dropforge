import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Native <select> with the Dropforge shell around it — keeps mobile's native
 * picker (best touch UX) while matching the rest of the design system.
 */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select"> & { wrapperClassName?: string }
>(({ className, wrapperClassName, children, ...props }, ref) => (
  <div className={cn("relative w-full", wrapperClassName)}>
    <select
      ref={ref}
      className={cn(
        "peer flex h-11 w-full cursor-pointer appearance-none rounded-xl border border-white/[0.08] bg-surface-2/60",
        "px-3.5 py-2 pr-10 text-sm text-foreground",
        "transition-[border-color,background-color,box-shadow] duration-200",
        "hover:border-white/[0.14]",
        "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden
      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors peer-hover:text-foreground"
    />
  </div>
));
Select.displayName = "Select";

export { Select };
