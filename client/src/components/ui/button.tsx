import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl",
    "text-sm font-medium tracking-tight",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-spring",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-45",
    "active:translate-y-px",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary-strong text-primary-foreground shadow-[0_8px_24px_-16px_hsl(var(--primary)/0.9)] hover:bg-primary-strong/90",
        /** Flat light-purple — the non-gradient counterpart to `default`. */
        accent:
          "border border-primary/30 bg-primary/15 text-primary hover:bg-primary/25 hover:border-primary/45",
        secondary:
          "border border-white/[0.07] bg-surface-2 text-secondary-foreground hover:bg-surface-3 hover:border-white/10",
        outline:
          "border border-white/[0.09] bg-white/[0.02] text-foreground hover:bg-white/[0.06] hover:border-white/[0.16]",
        ghost: "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
        destructive:
          "border border-danger/30 bg-danger/12 text-danger hover:bg-danger/20 hover:border-danger/45",
        success:
          "border border-success/30 bg-success/12 text-success hover:bg-success/20 hover:border-success/45",
        link: "h-auto p-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 rounded-lg px-3 text-[0.8125rem]",
        xs: "h-7 rounded-lg px-2.5 text-2xs",
        lg: "h-11 px-6",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Comp>
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
