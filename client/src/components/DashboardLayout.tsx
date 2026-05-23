import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Hammer, LogOut, ExternalLink, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

const adminNavItems = [
  { to: "/dashboard", label: "Overview" },
  { to: "/dashboard/campaigns", label: "Campaigns" },
  { to: "/dashboard/channels", label: "Channels" },
  { to: "/dashboard/settings", label: "Settings" },
];

const userNavItems = [
  { to: "/dashboard", label: "Miner" },
  { to: "/dashboard/inventory", label: "Inventory" },
  { to: "/dashboard/campaigns", label: "Drop lists" },
  { to: "/dashboard/settings", label: "Settings" },
];

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user, refresh } = useAuth();
  const navItems = user?.role === "user" ? userNavItems : adminNavItems;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={cn(
          "flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border/60 bg-card/40 p-4 backdrop-blur-md sm:p-6",
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:shadow-xl max-lg:transition-transform max-lg:duration-200",
          sidebarOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
          "lg:static lg:translate-x-0"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/20">
              <Hammer className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold">Dropforge</p>
              <p className="truncate text-xs capitalize text-muted-foreground">{user?.role} panel</p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 lg:hidden touch-target"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm transition-colors",
                pathname === item.to
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
          {user?.role === "user" && (
            <a
              href="https://www.twitch.tv/drops/inventory"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            >
              Twitch Inventory <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          )}
          {user?.role === "admin" && (
            <Link
              to="/dashboard/users"
              className={cn(
                "rounded-lg px-3 py-2.5 text-sm transition-colors",
                pathname === "/dashboard/users"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              Users
            </Link>
          )}
        </nav>

        <div className="mt-auto space-y-2">
          <p className="truncate text-xs text-muted-foreground">Signed in as {user?.username}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full min-h-10"
            onClick={async () => {
              await api.logout();
              await refresh();
              window.location.href = "/login";
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-3 sm:p-4 md:p-6 lg:p-8">
        <div className="mb-3 flex shrink-0 items-center gap-2 lg:hidden">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="touch-target shrink-0"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </main>
    </div>
  );
}
