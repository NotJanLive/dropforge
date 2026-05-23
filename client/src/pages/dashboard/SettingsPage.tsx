import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [globalMode, setGlobalMode] = useState("PRIORITY_ONLY");
  const [twitchLinked, setTwitchLinked] = useState(false);
  const [twitchLogin, setTwitchLogin] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.role === "admin") {
      api.globalSettings().then((s) => setGlobalMode(s.priorityMode)).catch(() => undefined);
    }
    if (user?.role === "user") {
      api.twitchStatus().then((s) => {
        setTwitchLinked(s.linked);
        setTwitchLogin(s.twitchLogin);
      }).catch(() => undefined);
    }
  }, [user]);

  const changePassword = async () => {
    setError("");
    try {
      await api.changePassword({ currentPassword, newPassword });
      setMessage("Password updated");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const saveGlobal = async () => {
    await api.updateGlobalSettings(globalMode);
    setMessage("Global settings saved");
  };

  const openTwitchLink = () => navigate("/dashboard/twitch-link");

  const unlink = async () => {
    await api.twitchUnlink();
    setTwitchLinked(false);
    setTwitchLogin(null);
    setMessage("Twitch unlinked");
  };

  return (
    <DashboardPage>
      <div className="mb-4 shrink-0 max-w-2xl space-y-2">
        <h1 className="text-xl font-semibold sm:text-2xl">Settings</h1>
        <p className="text-sm text-muted-foreground sm:text-base">Account and miner configuration</p>
        {message && <p className="text-sm text-primary">{message}</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <DashboardScrollArea className="max-w-2xl space-y-6 pb-2">
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Update your Dropforge login password</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Current password</Label>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>New password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <Button onClick={changePassword}>Update password</Button>
        </CardContent>
      </Card>

      {user?.role === "user" && (
        <Card>
          <CardHeader>
            <CardTitle>Twitch account</CardTitle>
            <CardDescription>
              {twitchLinked ? `Linked as ${twitchLogin}` : "Not linked"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-10" onClick={openTwitchLink}>
              {twitchLinked ? "Re-link Twitch" : "Link Twitch"}
            </Button>
            {twitchLinked && (
              <Button variant="destructive" className="min-h-10" onClick={unlink}>
                Unlink
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {user?.role === "admin" && (
        <Card>
          <CardHeader>
            <CardTitle>Global miner defaults</CardTitle>
            <CardDescription>Default priority mode for new users</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm"
              value={globalMode}
              onChange={(e) => setGlobalMode(e.target.value)}
            >
              <option value="PRIORITY_ONLY">Priority list only</option>
              <option value="ENDING_SOONEST">Ending soonest</option>
              <option value="LOW_AVBL_FIRST">Low availability first</option>
            </select>
            <Button onClick={saveGlobal}>Save global settings</Button>
          </CardContent>
        </Card>
      )}
      </DashboardScrollArea>
    </DashboardPage>
  );
}
