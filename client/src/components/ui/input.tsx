import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-white/[0.08] bg-surface-2/60 px-3.5 py-2 text-sm text-foreground",
        "transition-[border-color,background-color,box-shadow] duration-200",
        "placeholder:text-muted-foreground/70",
        "hover:border-white/[0.14]",
        "focus-visible:border-primary/60 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
