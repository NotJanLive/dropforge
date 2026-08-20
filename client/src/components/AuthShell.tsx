import { motion } from "framer-motion";
import { Boxes, Gauge, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/Brand";
import { cn } from "@/lib/utils";

const highlights = [
  {
    icon: Gauge,
    title: "Automatic mining",
    text: "Finds campaigns, picks a live channel and watches in the background.",
  },
  {
    icon: Boxes,
    title: "Live inventory",
    text: "Drop progress, claimed rewards and channels update in real time.",
  },
  {
    icon: ShieldCheck,
    title: "Per-user accounts",
    text: "Every account links its own Twitch profile with its own drop lists.",
  },
];

/** Shared shell for login and setup flows: brand panel + focused form column. */
export function AuthShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="dashboard-scroll relative h-dvh overflow-y-auto">
      {/* ambient backdrop — kept only on the auth screens; the dashboard is plain black */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          backgroundImage: [
            "radial-gradient(60rem 34rem at 12% -12%, hsl(var(--primary) / 0.16), transparent 60%)",
            "radial-gradient(48rem 28rem at 108% 4%, hsl(var(--brand-2) / 0.10), transparent 62%)",
            "radial-gradient(70rem 40rem at 50% 118%, hsl(var(--brand-3) / 0.07), transparent 60%)",
          ].join(", "),
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-grid bg-grid-cell [mask-image:radial-gradient(75%_65%_at_50%_0%,black,transparent)]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -right-24 top-1/4 h-[26rem] w-[26rem] rounded-full bg-primary/20 blur-[120px]"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed -left-32 bottom-0 h-[22rem] w-[22rem] rounded-full bg-brand-2/15 blur-[120px]"
      />

      <div className="relative mx-auto flex min-h-full w-full max-w-6xl flex-col justify-center gap-10 px-5 py-10 lg:flex-row lg:items-center lg:gap-16 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="hidden min-w-0 flex-1 lg:block"
        >
          <div className="flex items-center gap-3">
            <BrandMark className="h-11 w-11 rounded-[0.85rem]" />
            <div>
              <p className="text-2xl font-semibold tracking-tight">Dropforge</p>
              <p className="text-sm text-muted-foreground">Self-hosted Twitch Drops mining</p>
            </div>
          </div>

          <h2 className="mt-10 max-w-md text-4xl font-semibold leading-[1.1] tracking-tight">
            <span className="text-gradient">Forge your drops</span>
            <br />
            while you do something else.
          </h2>

          <ul className="mt-10 max-w-md space-y-5">
            {highlights.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium tracking-tight">{title}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: 0.06 }}
          className={cn("mx-auto w-full max-w-md shrink-0 lg:mx-0 lg:w-[26rem]", className)}
        >
          <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <BrandMark />
            <p className="text-lg font-semibold tracking-tight">Dropforge</p>
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  );
}
