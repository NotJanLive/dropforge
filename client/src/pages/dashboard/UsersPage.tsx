import { useEffect, useState } from "react";
import { Check, Copy, KeyRound, Trash2, UserPlus, Users as UsersIcon } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AuthUser } from "@/lib/api";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

type PasswordType = "temporary" | "permanent";

function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="grid gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className={cn(
            "rounded-lg px-3 py-2 text-xs font-medium transition-colors duration-200",
            value === option.key
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SecretValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — value stays visible */
    }
  };

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.03] py-1 pl-2.5 pr-1">
      <code className="font-mono text-xs text-primary">{value}</code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy password"
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  );
}

export function UsersPage() {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [username, setUsername] = useState("");
  const [passwordType, setPasswordType] = useState<PasswordType>("temporary");
  const [permanentPassword, setPermanentPassword] = useState("");
  const [createdInfo, setCreatedInfo] = useState<{ username: string; password: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetType, setResetType] = useState<PasswordType>("temporary");
  const [resetPassword, setResetPassword] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = () => api.listUsers().then((r) => setUsers(r.users)).catch(() => undefined);
  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError("");
    setCreatedInfo(null);
    setCreating(true);
    try {
      const result = await api.createUser({
        username,
        passwordType,
        password: passwordType === "permanent" ? permanentPassword : undefined,
      });
      setCreatedInfo({ username: result.username, password: result.password });
      setUsername("");
      setPermanentPassword("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const reveal = async (id: number) => {
    setError("");
    try {
      const result = await api.revealUserPassword(id);
      setRevealed((prev) => ({ ...prev, [id]: result.password }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password not available");
      load();
    }
  };

  const reset = async () => {
    if (resetUserId === null) return;
    setError("");
    try {
      const result = await api.resetUserPassword(resetUserId, {
        passwordType: resetType,
        password: resetType === "permanent" ? resetPassword : undefined,
      });
      setRevealed((prev) => ({
        ...prev,
        ...(result.canRevealPassword ? { [resetUserId]: result.password } : {}),
      }));
      if (!result.canRevealPassword) {
        setRevealed((prev) => {
          const next = { ...prev };
          delete next[resetUserId];
          return next;
        });
      }
      setResetUserId(null);
      setResetPassword("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  };

  const remove = async (id: number) => {
    await api.deleteUser(id);
    setConfirmDeleteId(null);
    load();
  };

  const minerUsers = users.filter((u) => u.role === "user");
  const resetTarget = users.find((u) => u.id === resetUserId);

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0 space-y-3.5">
        <PageHeader
          eyebrow="Admin"
          title="Users"
          description="Create and manage miner accounts."
          actions={
            <Badge variant="neutral" size="md" className="tabular-nums">
              {minerUsers.length} account{minerUsers.length === 1 ? "" : "s"}
            </Badge>
          }
        />
        {error && (
          <Alert tone="danger" role="alert" className="py-3">
            {error}
          </Alert>
        )}
      </div>

      <DashboardScrollArea className="pb-2">
        <div className="grid gap-3.5 xl:grid-cols-[22rem_minmax(0,1fr)] xl:items-start">
          <div className="space-y-3.5">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
                  Add user
                </CardTitle>
                <CardDescription className="text-xs">
                  Use a temporary password or set a permanent one.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-username">Username</Label>
                  <Input
                    id="new-username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Password type</Label>
                  <SegmentedChoice
                    value={passwordType}
                    onChange={setPasswordType}
                    options={[
                      { key: "temporary", label: "Temporary" },
                      { key: "permanent", label: "Permanent" },
                    ]}
                  />
                </div>

                {passwordType === "permanent" ? (
                  <div className="space-y-2">
                    <Label htmlFor="permanent-password">Password (min 8 characters)</Label>
                    <Input
                      id="permanent-password"
                      type="password"
                      autoComplete="new-password"
                      value={permanentPassword}
                      onChange={(e) => setPermanentPassword(e.target.value)}
                    />
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A temporary password is generated automatically. You can reveal it any time until
                    the user sets their own password.
                  </p>
                )}

                {createdInfo && (
                  <Alert tone="success" title={`Account created — ${createdInfo.username}`}>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      Password: <SecretValue value={createdInfo.password} />
                    </span>
                  </Alert>
                )}

                <Button onClick={create} loading={creating} className="w-full">
                  <UserPlus className="h-4 w-4" />
                  Create user
                </Button>
              </CardContent>
            </Card>

            {resetUserId !== null && (
              <Card className="border-primary/25">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <KeyRound className="h-4 w-4 text-primary" />
                    Reset password
                    {resetTarget && (
                      <span className="font-normal text-muted-foreground">
                        · {resetTarget.username}
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Resets login credentials and sends the user back to setup.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <SegmentedChoice
                    value={resetType}
                    onChange={setResetType}
                    options={[
                      { key: "temporary", label: "New temporary" },
                      { key: "permanent", label: "New permanent" },
                    ]}
                  />

                  {resetType === "permanent" && (
                    <div className="space-y-2">
                      <Label htmlFor="reset-password">New password</Label>
                      <Input
                        id="reset-password"
                        type="password"
                        autoComplete="new-password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button onClick={reset} className="flex-1">
                      Confirm reset
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setResetUserId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-2.5">
            {minerUsers.length === 0 && (
              <EmptyState
                icon={UsersIcon}
                title="No miner accounts yet"
                description="Create the first account on the left — the user links their own Twitch profile after signing in."
              />
            )}

            {minerUsers.map((u) => (
              <Card key={u.id} className="p-4">
                <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-sm font-semibold uppercase ring-1 ring-inset ring-primary/25">
                      {u.username.slice(0, 1)}
                    </span>
                    <div className="min-w-0 space-y-1.5">
                      <p className="truncate text-sm font-semibold tracking-tight">{u.username}</p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={u.setupComplete ? "success" : "warning"}>
                          {u.setupComplete ? "Setup complete" : `Setup step ${u.setupStep}`}
                        </Badge>
                        {u.mustChangePassword && <Badge variant="warning">Must change password</Badge>}
                        {u.passwordMode === "permanent" && !u.canRevealPassword && (
                          <Badge variant="neutral">Permanent password</Badge>
                        )}
                        {u.passwordMode === "user" && (
                          <Badge variant="neutral">Password set by user</Badge>
                        )}
                      </div>
                      {revealed[u.id] && (
                        <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                          Password: <SecretValue value={revealed[u.id]} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                    {u.canRevealPassword && (
                      <Button variant="outline" size="sm" onClick={() => reveal(u.id)}>
                        Show password
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setResetUserId(u.id);
                        setConfirmDeleteId(null);
                      }}
                    >
                      Reset password
                    </Button>
                    {confirmDeleteId === u.id ? (
                      <div className="flex gap-2">
                        <Button variant="destructive" size="sm" onClick={() => remove(u.id)}>
                          Confirm delete
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setConfirmDeleteId(u.id)}
                        aria-label={`Delete ${u.username}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
