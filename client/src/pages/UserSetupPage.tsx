import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, GripVertical, Loader2, Plus, X } from "lucide-react";
import { StepWizard } from "@/components/StepWizard";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TwitchDeviceLink } from "@/components/TwitchDeviceLink";
import { api } from "@/lib/api";
import { buildGameOptions, gamesAvailableForAdd } from "@/lib/campaignGames";
import { resolveGameImageUrl } from "@/lib/gameImage";
import { TwitchImage } from "@/components/TwitchImage";
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
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [priorityGames, setPriorityGames] = useState<string[]>([]);
  const [pickGame, setPickGame] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const totalSteps = skipPassword ? 3 : 4;
  const wizardStep = skipPassword ? step - 1 : step;

  useEffect(() => {
    if (step !== 2) return;
    setLoading(true);
    setError("");
    api
      .campaigns({ refresh: true })
      .then((data) => {
        setCampaigns(data.campaigns);
        setStep(3);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load campaigns"))
      .finally(() => setLoading(false));
  }, [step]);

  const availableGames = useMemo(
    () =>
      buildGameOptions(
        campaigns.map((c) => ({
          gameName: c.gameName,
          gameImageUrl: c.gameImageUrl,
          status: c.status,
          linked: c.linked,
        }))
      ),
    [campaigns]
  );

  const addableGames = useMemo(
    () => gamesAvailableForAdd(availableGames, priorityGames, []),
    [availableGames, priorityGames]
  );

  const addPriorityGame = () => {
    const name = pickGame.trim();
    if (!name || priorityGames.includes(name)) return;
    setPriorityGames([...priorityGames, name]);
    setPickGame("");
  };

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
      } else if (step === 3) {
        await api.updateMinerSettings({
          priorityGames,
          excludeGames: [],
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
        ["Priority games", "Optional — pick games to mine first. You can change this later under Drop lists."],
      ] as const)
    : ([
        ["Set your password", "Replace the temporary password from your admin."],
        ["Link Twitch", "Authorize Dropforge using Twitch device login."],
        ["Loading games", "Fetching active drop campaigns from your Twitch account."],
        ["Priority games", "Optional — pick games to mine first. You can change this later under Drop lists."],
      ] as const);

  const title = titles[wizardStep] ?? titles[0];

  return (
    <StepWizard step={wizardStep} totalSteps={totalSteps} title={title[0]} description={title[1]}>
      {step === 0 && (
        <div className="space-y-4">
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
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            At least 8 characters. Both fields must match.
          </p>
        </div>
      )}

      {step === 1 && (
        <TwitchDeviceLink
          onLinked={async () => {
            await api.completeUserStep(2);
            await refresh();
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-4">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading active games from Twitch…</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {availableGames.length} game{availableGames.length === 1 ? "" : "s"} with drop campaigns
            {priorityGames.length === 0
              ? " — optional, add any below or finish without."
              : ` · ${priorityGames.length} selected.`}
          </p>

          {availableGames.length === 0 ? (
            <Alert tone="warning">
              No campaigns found on Twitch right now. You can finish setup and add games later under
              Drop lists.
            </Alert>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="setup-game">Game</Label>
              <div className="flex gap-2">
                <Select
                  id="setup-game"
                  value={pickGame}
                  onChange={(e) => setPickGame(e.target.value)}
                >
                  <option value="">Select a game…</option>
                  {addableGames.map((g) => (
                    <option key={g.name} value={g.name}>
                      {g.name} ({g.campaignCount} campaign{g.campaignCount === 1 ? "" : "s"})
                    </option>
                  ))}
                </Select>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label="Add game"
                  disabled={!pickGame}
                  onClick={addPriorityGame}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {priorityGames.length > 0 && (
            <ul className="space-y-2">
              {priorityGames.map((game, index) => {
                const meta = availableGames.find((g) => g.name === game);
                return (
                  <li
                    key={game}
                    className="flex items-center gap-2.5 rounded-xl border border-primary/25 bg-primary/[0.06] p-2"
                  >
                    <span className="flex w-5 shrink-0 items-center justify-center text-2xs font-semibold tabular-nums text-primary">
                      {index + 1}
                    </span>
                    <TwitchImage
                      src={resolveGameImageUrl({ gameImageUrl: meta?.imageUrl, gameName: game })}
                      fallbackSrc=""
                      alt=""
                      className="h-9 w-7 shrink-0 rounded-md object-cover"
                      fallbackClassName="h-9 w-7 shrink-0 rounded-md bg-white/[0.06]"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{game}</span>
                    <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => setPriorityGames(priorityGames.filter((g) => g !== game))}
                      aria-label={`Remove ${game}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {error && (
        <Alert tone="danger" role="alert" className="mt-4 py-3">
          {error}
        </Alert>
      )}

      {step !== 2 && step !== 1 && (
        <Button className="mt-5 w-full" size="lg" loading={loading} onClick={next}>
          {step === 3 ? "Finish setup" : "Continue"}
          {!loading && <ArrowRight className="h-4 w-4" />}
        </Button>
      )}
    </StepWizard>
  );
}
