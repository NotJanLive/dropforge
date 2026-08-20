import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  ExternalLink,
  Gauge,
  Github,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Package,
  Radio,
  Settings2,
  Users as UsersIcon,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandLockup, BrandMark } from "@/components/Brand";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface NavItem {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon;
}

const adminNavItems: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/campaigns", label: "Campaigns", icon: ListChecks },
  { to: "/dashboard/channels", label: "Channels", icon: Radio },
  { to: "/dashboard/users", label: "Users", icon: UsersIcon },
  { to: "/dashboard/settings", label: "Settings", icon: Settings2 },
];

const userNavItems: NavItem[] = [
  { to: "/dashboard", label: "Miner", icon: Gauge },
  { to: "/dashboard/inventory", label: "Inventory", icon: Package },
  { to: "/dashboard/campaigns", label: "Drop lists", short: "Drops", icon: ListChecks },
  { to: "/dashboard/settings", label: "Settings", icon: Settings2 },
];

const extraTitles: Record<string, string> = {
  "/dashboard/twitch-link": "Link Twitch",
};

const TWITCH_INVENTORY_URL = "https://www.twitch.tv/drops/inventory";

function useSignOut() {
  const { refresh } = useAuth();
  return async () => {
    await api.logout();
    await refresh();
    window.location.href = "/login";
  };
}

function AccountAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
        "bg-primary/15 text-sm font-semibold uppercase text-foreground ring-1 ring-inset ring-primary/25",
        className
      )}
    >
      {name.slice(0, 1) || "?"}
    </span>
  );
}

function BuildLink({ className }: { className?: string }) {
  return (
    <a
      href={`https://github.com/NotJanLive/dropforge/tree/${__GIT_BRANCH__}`}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1.5 text-2xs text-muted-foreground/60 transition-colors hover:text-muted-foreground",
        className
      )}
    >
      <Github className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate font-mono">
        {__GIT_BRANCH__} @ {__COMMIT_HASH__}
      </span>
    </a>
  );
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
        active ? "text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={{ type: "spring", stiffness: 420, damping: 34 }}
          className="absolute inset-0 rounded-xl border border-primary/25 bg-primary/15"
        />
      )}
      <Icon
        className={cn(
          "relative h-[1.05rem] w-[1.05rem] shrink-0 transition-colors",
          active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
        )}
      />
      <span className="relative truncate">{item.label}</span>
    </Link>
  );
}

function DesktopSidebar({
  navItems,
  pathname,
  username,
  role,
  isUser,
  onSignOut,
}: {
  navItems: NavItem[];
  pathname: string;
  username: string;
  role: string;
  isUser: boolean;
  onSignOut: () => void;
}) {
  return (
    <aside className="relative z-20 hidden w-[16.5rem] shrink-0 flex-col border-r border-white/[0.06] bg-[hsl(240_12%_4%)] lg:flex">
      <div className="px-5 py-5">
        <BrandLockup subtitle={`${role} panel`} />
      </div>

      <nav className="scroll-slim flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3">
        <p className="px-3 pb-1.5 pt-2 text-2xs font-semibold uppercase tracking-micro text-muted-foreground/60">
          Navigate
        </p>
        {navItems.map((item) => (
          <SidebarLink key={item.to} item={item} active={pathname === item.to} />
        ))}

        {isUser && (
          <>
            <p className="px-3 pb-1.5 pt-5 text-2xs font-semibold uppercase tracking-micro text-muted-foreground/60">
              Twitch
            </p>
            <a
              href={TWITCH_INVENTORY_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              <ExternalLink className="h-[1.05rem] w-[1.05rem] shrink-0" />
              <span className="truncate">Twitch inventory</span>
            </a>
          </>
        )}
      </nav>

      <div className="space-y-3 border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
          <AccountAvatar name={username} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{username}</p>
            <p className="truncate text-2xs uppercase tracking-micro text-muted-foreground">{role}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
        <BuildLink className="w-full justify-center" />
      </div>
    </aside>
  );
}

function MobileTopBar({
  title,
  username,
  onOpenAccount,
}: {
  title: string;
  username: string;
  onOpenAccount: () => void;
}) {
  return (
    <header className="safe-top sticky top-0 z-30 flex shrink-0 items-center gap-3 border-b border-white/[0.06] bg-background/80 px-4 py-3 backdrop-blur-xl lg:hidden">
      <BrandMark className="h-8 w-8 rounded-[0.6rem]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-2xs uppercase tracking-micro text-muted-foreground">Dropforge</p>
        <p className="truncate text-sm font-semibold leading-tight tracking-tight">{title}</p>
      </div>
      <button
        type="button"
        onClick={onOpenAccount}
        aria-label="Open account menu"
        className="rounded-full transition-transform active:scale-95"
      >
        <AccountAvatar name={username} className="h-9 w-9" />
      </button>
    </header>
  );
}

function MobileTabBar({
  navItems,
  pathname,
}: {
  navItems: NavItem[];
  pathname: string;
}) {
  return (
    <nav className="safe-bottom sticky bottom-0 z-30 shrink-0 border-t border-white/[0.06] bg-background/85 backdrop-blur-xl lg:hidden">
      <div className="mx-auto flex max-w-md items-stretch justify-around px-1 py-1.5">
        {navItems.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5 transition-colors"
            >
              {active && (
                <motion.span
                  layoutId="tabbar-active"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  className="absolute inset-x-2 inset-y-0 rounded-xl border border-primary/25 bg-primary/15"
                />
              )}
              <Icon
                className={cn(
                  "relative h-[1.15rem] w-[1.15rem] transition-colors",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              />
              <span
                className={cn(
                  "relative truncate text-[0.625rem] font-medium leading-none transition-colors",
                  active ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {item.short ?? item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function AccountSheet({
  open,
  onClose,
  username,
  role,
  isUser,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  role: string;
  isUser: boolean;
  onSignOut: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.button
            type="button"
            aria-label="Close account menu"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 34 }}
            className="safe-bottom absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-white/[0.08] bg-[hsl(240_15%_7%)] p-4 shadow-lift"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
            <div className="flex items-center gap-3">
              <AccountAvatar name={username} className="h-11 w-11 text-base" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold leading-tight tracking-tight">
                  {username}
                </p>
                <Badge variant="primary" className="mt-1 uppercase tracking-micro">
                  {role}
                </Badge>
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-5 space-y-2">
              {isUser && (
                <a
                  href={TWITCH_INVENTORY_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={onClose}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-sm font-medium transition-colors active:bg-white/[0.06]"
                >
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  Twitch inventory
                </a>
              )}
              <Button variant="outline" className="w-full justify-center" onClick={onSignOut}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>

            <div className="mt-4 flex justify-center">
              <BuildLink />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const signOut = useSignOut();
  const [accountOpen, setAccountOpen] = useState(false);

  const isUser = user?.role === "user";
  const navItems = isUser ? userNavItems : adminNavItems;
  const username = user?.username ?? "";
  const role = user?.role ?? "";

  useEffect(() => {
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAccountOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [accountOpen]);

  const pageTitle = useMemo(() => {
    const match = navItems.find((item) => item.to === pathname);
    return match?.label ?? extraTitles[pathname] ?? "Dashboard";
  }, [navItems, pathname]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden">
      <DesktopSidebar
        navItems={navItems}
        pathname={pathname}
        username={username}
        role={role}
        isUser={isUser}
        onSignOut={signOut}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <MobileTopBar
          title={pageTitle}
          username={username}
          onOpenAccount={() => setAccountOpen(true)}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-4 pb-3 pt-4 sm:px-6 sm:pb-4 lg:px-6 lg:py-5">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        </main>

        <MobileTabBar navItems={navItems} pathname={pathname} />
      </div>

      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        username={username}
        role={role}
        isUser={isUser}
        onSignOut={signOut}
      />
    </div>
  );
}
