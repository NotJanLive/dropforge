import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface TwitchDeviceLinkProps {
  onLinked: () => void | Promise<void>;
  idleHint?: string;
}

export function TwitchDeviceLink({ onLinked, idleHint }: TwitchDeviceLinkProps) {
  const [userCode, setUserCode] = useState("");
  const [verificationUri, setVerificationUri] = useState("");
  const [intervalSec, setIntervalSec] = useState(5);
  const [pollStatus, setPollStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const startLink = async () => {
    setError("");
    setLoading(true);
    setPollStatus("");
    try {
      const flow = await api.twitchLinkStart();
      setUserCode(flow.userCode);
      setVerificationUri(flow.verificationUri);
      setIntervalSec(flow.interval);
      setPollStatus("Waiting for authorization…");

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
      await onLinked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Twitch link failed");
      setPollStatus("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!userCode ? (
        <>
          <p className="text-sm text-muted-foreground">
            {idleHint ??
              "Authorize Dropforge with your Twitch account using a device code at twitch.tv/activate."}
          </p>
          <Button className="w-full min-h-10" disabled={loading} onClick={startLink}>
            {loading ? "Starting…" : "Start Twitch authorization"}
          </Button>
        </>
      ) : (
        <>
          <div className="rounded-lg bg-secondary p-4 text-center">
            <p className="mb-1 text-xs text-muted-foreground">Your code</p>
            <p className="text-2xl font-bold tracking-widest">{userCode}</p>
          </div>
          <Button variant="outline" className="w-full min-h-10" asChild>
            <a href={verificationUri} target="_blank" rel="noreferrer">
              Open twitch.tv/activate
            </a>
          </Button>
          {pollStatus && <p className="text-sm text-muted-foreground">{pollStatus}</p>}
          {!loading && pollStatus.startsWith("Waiting") && (
            <Button variant="ghost" className="w-full" onClick={startLink}>
              Generate new code
            </Button>
          )}
        </>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && userCode && (
        <p className="text-xs text-muted-foreground">Checking every {intervalSec}s…</p>
      )}
    </div>
  );
}
