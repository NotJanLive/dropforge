import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type AuthUser } from "@/lib/api";
import { DashboardPage, DashboardPageHeader, DashboardScrollArea } from "@/components/DashboardPage";

type PasswordType = "temporary" | "permanent";

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
  const [error, setError] = useState("");

  const load = () => api.listUsers().then((r) => setUsers(r.users)).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const create = async () => {
    setError("");
    setCreatedInfo(null);
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
    load();
  };

  return (
    <DashboardPage>
      <DashboardPageHeader>
        <h1 className="text-xl font-semibold sm:text-2xl">Users</h1>
        <p className="text-muted-foreground">Create and manage miner accounts</p>
      </DashboardPageHeader>

      <DashboardScrollArea className="space-y-6 pb-2">
      <Card>
        <CardHeader>
          <CardTitle>Add user</CardTitle>
          <CardDescription>Use a temporary password or set a permanent one</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Username</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Password type</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={passwordType === "temporary" ? "default" : "outline"}
                onClick={() => setPasswordType("temporary")}
              >
                Temporary
              </Button>
              <Button
                type="button"
                size="sm"
                variant={passwordType === "permanent" ? "default" : "outline"}
                onClick={() => setPasswordType("permanent")}
              >
                Permanent
              </Button>
            </div>
          </div>

          {passwordType === "permanent" && (
            <div className="space-y-2">
              <Label>Password (min 8 characters)</Label>
              <Input
                type="password"
                value={permanentPassword}
                onChange={(e) => setPermanentPassword(e.target.value)}
              />
            </div>
          )}

          {passwordType === "temporary" && (
            <p className="text-sm text-muted-foreground">
              A temporary password is generated automatically. You can reveal it anytime until the user sets their own password.
            </p>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          {createdInfo && (
            <div className="rounded-lg bg-secondary p-3 text-sm">
              Password for <strong>{createdInfo.username}</strong>:{" "}
              <code className="text-primary">{createdInfo.password}</code>
            </div>
          )}
          <Button onClick={create}>Create user</Button>
        </CardContent>
      </Card>

      {resetUserId !== null && (
        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>
              Resets login credentials and sends the user back to setup
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={resetType === "temporary" ? "default" : "outline"}
                onClick={() => setResetType("temporary")}
              >
                New temporary
              </Button>
              <Button
                type="button"
                size="sm"
                variant={resetType === "permanent" ? "default" : "outline"}
                onClick={() => setResetType("permanent")}
              >
                New permanent
              </Button>
            </div>
            {resetType === "permanent" && (
              <div className="space-y-2">
                <Label>New password</Label>
                <Input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} />
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={reset}>Confirm reset</Button>
              <Button variant="outline" onClick={() => setResetUserId(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {users.filter((u) => u.role === "user").map((u) => (
          <Card key={u.id}>
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="min-w-0 flex flex-col justify-center gap-0.5">
                <p className="font-medium leading-snug">{u.username}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {u.setupComplete ? "Setup complete" : `Setup step ${u.setupStep}`}
                  {u.mustChangePassword && " · Must change password"}
                  {u.passwordMode === "permanent" && !u.canRevealPassword && " · Permanent password"}
                  {u.passwordMode === "user" && " · Password set by user"}
                </p>
                {revealed[u.id] && (
                  <p className="mt-1 text-sm leading-snug">
                    Password: <code className="text-primary">{revealed[u.id]}</code>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                {u.canRevealPassword && (
                  <Button variant="outline" size="sm" onClick={() => reveal(u.id)}>
                    Show password
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setResetUserId(u.id)}>
                  Reset password
                </Button>
                <Button variant="destructive" size="sm" onClick={() => remove(u.id)}>Delete</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
