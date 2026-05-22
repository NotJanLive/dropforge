import { Link, useLocation } from "react-router-dom";
import { Hammer, LogOut, ExternalLink } from "lucide-react";
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

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border/60 bg-card/40 p-6 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-primary/20 flex items-center justify-center">
            <Hammer className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold">Dropforge</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role} panel</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors",
                pathname === item.to ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
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
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground flex items-center gap-2"
            >
              Twitch Inventory <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {user?.role === "admin" && (
            <Link
              to="/dashboard/users"
              className={cn(
                "rounded-lg px-3 py-2 text-sm transition-colors",
                pathname === "/dashboard/users" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              )}
            >
              Users
            </Link>
          )}
        </nav>

        <div className="mt-auto space-y-2">
          <p className="text-xs text-muted-foreground">Signed in as {user?.username}</p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
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
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-6 lg:p-8">{children}</main>
    </div>
  );
}
