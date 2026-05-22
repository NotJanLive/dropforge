import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { StepWizard } from "@/components/StepWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
            <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 8 characters)</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mode">Default priority mode</Label>
            <select
              id="mode"
              className="flex h-10 w-full rounded-lg border border-input bg-secondary/50 px-3 text-sm"
              value={priorityMode}
              onChange={(e) => setPriorityMode(e.target.value)}
            >
              <option value="PRIORITY_ONLY">Priority list only</option>
              <option value="ENDING_SOONEST">Ending soonest</option>
              <option value="LOW_AVBL_FIRST">Low availability first</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button className="w-full" disabled={loading} onClick={submit}>
            Continue
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
      <Button className="w-full" disabled={loading} onClick={submit}>
        Open dashboard
      </Button>
    </StepWizard>
  );
}
