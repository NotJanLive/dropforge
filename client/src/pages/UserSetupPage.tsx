import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { StepWizard } from "@/components/StepWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropListsEditor } from "@/components/DropListsEditor";
import { api } from "@/lib/api";
import { buildGameOptions } from "@/lib/campaignGames";
import { useAuth } from "@/context/AuthContext";

type CampaignItem = {
  id: string;
  name: string;
  gameName: string;
  gameImageUrl: string;
  status: string;
  linked: boolean;
  endsAt: string;
  dropCount: number;
};

export function UserSetupPage() {
  const { user, refresh } = useAuth();
  const skipPassword = !user?.mustChangePassword;
  const [step, setStep] = useState(skipPassword ? 1 : 0);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [priorityGames, setPriorityGames] = useState<string[]>([]);
  const [excludeGames, setExcludeGames] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pollStatus, setPollStatus] = useState("");
  const navigate = useNavigate();

  const totalSteps = skipPassword ? 3 : 4;
  const wizardStep = skipPassword ? step - 1 : step;

  useEffect(() => {
    if (step !== 2) return;
    setLoading(true);
    api
      .minerReload()
      .then((data) => {
        const campaigns = (data.status?.campaigns ?? []).map((c) => ({
          id: c.id,
          name: c.name,
          gameName: c.gameName,
          gameImageUrl: c.gameImageUrl,
          status: c.status,
          linked: c.linked,
          endsAt: c.endsAt,
          dropCount: c.drops.length,
        }));
        setCampaigns(campaigns);
        setStep(3);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load campaigns"))
      .finally(() => setLoading(false));
  }, [step]);

  const activeGames = useMemo(
    () =>
      buildGameOptions(
        campaigns.map((c) => ({
          gameName: c.gameName,
          gameImageUrl: c.gameImageUrl,
          status: c.status,
          linked: c.linked,
        })),
        { activeOnly: true }
      ),
    [campaigns]
  );

  const next = async () => {
    setError("");
    setLoading(true);
    try {
      if (step === 0) {
        if (newPassword.length < 8 || newPassword !== confirmPassword) {
          throw new Error("Passwords must match and be at least 8 characters");
        }
        await api.changePassword({ newPassword });
        await api.completeUserStep(1);
        await refresh();
        setStep(1);
      } else if (step === 1) {
        const flow = await api.twitchLinkStart();
        setUserCode(flow.userCode);
        setVerificationUri(flow.verificationUri);
        setDeviceId(flow.deviceId);
        setPollStatus("Waiting for authorization...");
        const poll = async (): Promise<boolean> => {
          const result = await api.twitchLinkPoll(flow.deviceId);
          if (result.status === "completed") return true;
          if (result.status === "expired" || result.status === "failed") {
            throw new Error("Twitch authorization failed or expired");
          }
          await new Promise((r) => setTimeout(r, flow.interval * 1000));
          return poll();
        };
        await poll();
        setPollStatus("Twitch linked successfully");
        await api.completeUserStep(2);
        await refresh();
        setStep(2);
      } else {
        await api.updateMinerSettings({
          priorityGames,
          excludeGames,
          priorityMode: "PRIORITY_ONLY",
        });
        await api.finishUserSetup();
        await refresh();
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  const titles = skipPassword
    ? ([
        ["Link Twitch", "Authorize Dropforge using Twitch device login."],
        ["Loading games", "Fetching active drop campaigns from your Twitch account."],
        ["Priority games", "Pick games to mine — top of the list is mined first."],
      ] as const)
    : ([
        ["Set your password", "Replace the temporary password from your admin."],
        ["Link Twitch", "Authorize Dropforge using Twitch device login."],
        ["Loading games", "Fetching active drop campaigns from your Twitch account."],
        ["Priority games", "Pick games to mine — top of the list is mined first."],
      ] as const);

  const title = titles[wizardStep] ?? titles[0];

  return (
    <StepWizard
      step={wizardStep}
      totalSteps={totalSteps}
      title={title[0]}
      description={title[1]}
    >
      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>New password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Confirm password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {!userCode ? (
            <p className="text-sm text-muted-foreground">
              Click continue to generate a device code. You'll enter it at twitch.tv/activate.
            </p>
          ) : (
            <>
              <div className="rounded-lg bg-secondary p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Your code</p>
                <p className="text-2xl font-bold tracking-widest">{userCode}</p>
              </div>
              <Button variant="outline" className="w-full" asChild>
                <a href={verificationUri} target="_blank" rel="noreferrer">
                  Open twitch.tv/activate
                </a>
              </Button>
              {pollStatus && <p className="text-sm text-muted-foreground">{pollStatus}</p>}
            </>
          )}
        </div>
      )}

      {step === 2 && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          Loading active games from Twitch…
        </p>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {activeGames.length} active games with campaigns · {priorityGames.length} in priority list
          </p>
          <DropListsEditor
            games={activeGames}
            priorityGames={priorityGames}
            excludeGames={excludeGames}
            priorityMode="PRIORITY_ONLY"
            onPriorityGamesChange={setPriorityGames}
            onExcludeGamesChange={setExcludeGames}
            onPriorityModeChange={() => undefined}
            activeOnlyHint
            hidePriorityMode
          />
          {priorityGames.length === 0 && (
            <p className="text-xs text-amber-400/90">
              You can finish without games — the miner stays idle until you add some under Drop lists.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400 mt-4">{error}</p>}
      {step !== 2 && (
        <Button className="w-full mt-4" disabled={loading} onClick={next}>
          {loading ? "Please wait…" : step === 3 ? "Finish setup" : "Continue"}
        </Button>
      )}
    </StepWizard>
  );
}
