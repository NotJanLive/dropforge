import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, PartyPopper } from "lucide-react";
import { StepWizard } from "@/components/StepWizard";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

export function AdminSetupPage() {
  const { status, user, refresh } = useAuth();
  const [step, setStep] = useState(
    () => (status?.initialized && user?.role === "admin" && !user.setupComplete ? 1 : 0)
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [priorityMode, setPriorityMode] = useState("PRIORITY_ONLY");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async () => {
    setError("");
    setLoading(true);
    try {
      if (step === 0) {
        await api.setupAdmin({ username, password, priorityMode });
        await refresh();
        setStep(1);
      } else {
        await api.finishAdminSetup();
        await refresh();
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  if (step === 0) {
    return (
      <StepWizard
        step={0}
        totalSteps={2}
        title="Welcome to Dropforge"
        description="Create the admin account that will manage this instance."
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Admin username</Label>
            <Input
              id="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 8 characters)</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mode">Default priority mode</Label>
            <Select id="mode" value={priorityMode} onChange={(e) => setPriorityMode(e.target.value)}>
              <option value="PRIORITY_ONLY">Priority list only</option>
              <option value="ENDING_SOONEST">Ending soonest</option>
              <option value="LOW_AVBL_FIRST">Low availability first</option>
            </Select>
          </div>

          {error && (
            <Alert tone="danger" role="alert" className="py-3">
              {error}
            </Alert>
          )}

          <Button className="w-full" size="lg" loading={loading} onClick={submit}>
            Continue
            {!loading && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </StepWizard>
    );
  }

  return (
    <StepWizard
      step={1}
      totalSteps={2}
      title="You're all set"
      description="Your admin account is ready. Next you'll configure users and global miner settings from the dashboard."
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-2xl border border-success/25 bg-success/[0.07] px-4 py-3.5">
          <PartyPopper className="h-5 w-5 shrink-0 text-success" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Create user accounts under <span className="font-medium text-foreground">Users</span>, then
            share their password so they can link Twitch.
          </p>
        </div>

        {error && (
          <Alert tone="danger" role="alert" className="py-3">
            {error}
          </Alert>
        )}

        <Button className="w-full" size="lg" loading={loading} onClick={submit}>
          Open dashboard
          {!loading && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
    </StepWizard>
  );
}
