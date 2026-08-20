import { BrandMark } from "@/components/Brand";

export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4">
      <div className="relative">
        <span
          className="absolute inset-0 animate-pulse-ring rounded-[0.95rem] bg-primary/40"
          aria-hidden
        />
        <BrandMark className="relative h-12 w-12 rounded-[0.95rem]" />
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        {label}
      </div>
    </div>
  );
}
