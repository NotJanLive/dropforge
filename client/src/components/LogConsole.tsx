import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { MinerLogEntry } from "@/lib/api";
import { cn } from "@/lib/utils";

const levelStyles: Record<MinerLogEntry["level"], { text: string; dot: string }> = {
  error: { text: "text-danger", dot: "bg-danger" },
  warn: { text: "text-warning", dot: "bg-warning" },
  success: { text: "text-success", dot: "bg-success" },
  info: { text: "text-muted-foreground", dot: "bg-muted-foreground/60" },
};

function LogLine({ entry }: { entry: MinerLogEntry }) {
  const style = levelStyles[entry.level] ?? levelStyles.info;
  return (
    <div className="group flex items-start gap-2 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.04]">
      <span className={cn("mt-[0.42rem] h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} aria-hidden />
      <time className="shrink-0 tabular-nums text-muted-foreground/50">
        {new Date(entry.time).toLocaleTimeString()}
      </time>
      <span className={cn("min-w-0 break-words", style.text)}>{entry.message}</span>
    </div>
  );
}

/**
 * Miner output stream. Entries arrive newest-first, so the view pins to the top
 * whenever new lines land.
 */
export function LogConsole({
  logs,
  className,
  emptyText = "Waiting for miner events…",
  title,
  scrollClassName,
}: {
  logs: MinerLogEntry[];
  className?: string;
  emptyText?: string;
  title?: string;
  scrollClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0;
  }, [logs.length]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {title && (
        <div className="mb-2 flex items-center gap-2 text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          {title}
        </div>
      )}
      <div
        ref={ref}
        className={cn(
          // scroll-slim (not dashboard-scroll): no overscroll containment, so the
          // wheel keeps scrolling the page once the log hits its boundary.
          "scroll-slim min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/[0.06] bg-[hsl(240_16%_3%)] p-2 font-mono text-2xs leading-relaxed",
          scrollClassName
        )}
      >
        {logs.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground/70">{emptyText}</p>
        ) : (
          logs.map((entry, i) => <LogLine key={`${entry.time}-${i}`} entry={entry} />)
        )}
      </div>
    </div>
  );
}
