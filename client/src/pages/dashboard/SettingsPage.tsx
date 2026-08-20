import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Link2, Sliders, Unlink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { DashboardPage, DashboardScrollArea } from "@/components/DashboardPage";
import { PageHeader } from "@/components/PageHeader";

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
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);

  useEffect(() => {
    if (user?.role === "admin") {
      api.globalSettings().then((s) => setGlobalMode(s.priorityMode)).catch(() => undefined);
    }
    if (user?.role === "user") {
      api
        .twitchStatus()
        .then((s) => {
          setTwitchLinked(s.linked);
          setTwitchLogin(s.twitchLogin);
        })
        .catch(() => undefined);
    }
  }, [user]);

  const changePassword = async () => {
    setError("");
    setSavingPassword(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setMessage("Password updated");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingPassword(false);
    }
  };

  const saveGlobal = async () => {
    setSavingGlobal(true);
    try {
      await api.updateGlobalSettings(globalMode);
      setMessage("Global settings saved");
    } finally {
      setSavingGlobal(false);
    }
  };

  const openTwitchLink = () => navigate("/dashboard/twitch-link");

  const unlink = async () => {
    await api.twitchUnlink();
    setTwitchLinked(false);
    setTwitchLogin(null);
    setMessage("Twitch unlinked");
  };

  return (
    <DashboardPage className="gap-4">
      <div className="shrink-0 space-y-3.5">
        <PageHeader
          eyebrow="Account"
          title="Settings"
          description="Account and miner configuration."
        />
        {message && (
          <Alert tone="success" className="py-3">
            {message}
          </Alert>
        )}
        {error && (
          <Alert tone="danger" role="alert" className="py-3">
            {error}
          </Alert>
        )}
      </div>

      <DashboardScrollArea className="pb-2">
        <div className="max-w-2xl space-y-3.5">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                Password
              </CardTitle>
              <CardDescription className="text-xs">
                Update your Dropforge login password.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>
              <Button onClick={changePassword} loading={savingPassword} className="max-sm:w-full">
                Update password
              </Button>
            </CardContent>
          </Card>

          {user?.role === "user" && (
            <Card>
              <CardHeader className="pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Link2 className="h-4 w-4 text-muted-foreground" />
                    Twitch account
                  </CardTitle>
                  <Badge variant={twitchLinked ? "success" : "warning"}>
                    {twitchLinked ? "Linked" : "Not linked"}
                  </Badge>
                </div>
                <CardDescription className="text-xs">
                  {twitchLinked
                    ? `Dropforge mines drops as ${twitchLogin}.`
                    : "Link an account so the miner can watch streams for you."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button variant="outline" className="max-sm:w-full" onClick={openTwitchLink}>
                  {twitchLinked ? "Re-link Twitch" : "Link Twitch"}
                </Button>
                {twitchLinked && (
                  <Button variant="destructive" className="max-sm:w-full" onClick={unlink}>
                    <Unlink className="h-4 w-4" />
                    Unlink
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {user?.role === "admin" && (
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Sliders className="h-4 w-4 text-muted-foreground" />
                  Global miner defaults
                </CardTitle>
                <CardDescription className="text-xs">
                  Default priority mode applied to new users.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="global-mode">Priority mode</Label>
                  <Select
                    id="global-mode"
                    value={globalMode}
                    onChange={(e) => setGlobalMode(e.target.value)}
                  >
                    <option value="PRIORITY_ONLY">Priority list only</option>
                    <option value="ENDING_SOONEST">Ending soonest</option>
                    <option value="LOW_AVBL_FIRST">Low availability first</option>
                  </Select>
                </div>
                <Button onClick={saveGlobal} loading={savingGlobal} className="max-sm:w-full">
                  Save global settings
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </DashboardScrollArea>
    </DashboardPage>
  );
}
