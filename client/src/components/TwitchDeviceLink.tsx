import { useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, Shield } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

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
  const [copied, setCopied] = useState(false);

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

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the code stays visible */
    }
  };

  const linked = pollStatus.startsWith("Twitch linked");

  return (
    <div className="space-y-4">
      {!userCode ? (
        <>
          <div className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {idleHint ??
                "Authorize Dropforge with your Twitch account using a device code at twitch.tv/activate."}
            </p>
          </div>
          <Button className="w-full" size="lg" loading={loading} onClick={startLink}>
            Start Twitch authorization
          </Button>
        </>
      ) : (
        <>
          <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/10 p-5 text-center">
            <p className="text-2xs font-semibold uppercase tracking-micro text-muted-foreground">
              Your device code
            </p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-[0.35em] text-foreground">
              {userCode}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={copyCode}
              aria-label="Copy code"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-success" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy code
                </>
              )}
            </Button>
          </div>

          <Button variant="secondary" className="w-full" size="lg" asChild>
            <a href={verificationUri} target="_blank" rel="noreferrer">
              Open twitch.tv/activate
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>

          {pollStatus && (
            <div
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm",
                linked
                  ? "border-success/25 bg-success/[0.07] text-success"
                  : "border-white/[0.06] bg-white/[0.02] text-muted-foreground"
              )}
            >
              {linked ? (
                <Check className="h-4 w-4" />
              ) : (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-primary" />
                  <span className="relative h-2 w-2 rounded-full bg-primary" />
                </span>
              )}
              {pollStatus}
              {loading && !linked && (
                <span className="text-muted-foreground/60">· checking every {intervalSec}s</span>
              )}
            </div>
          )}

          {!loading && pollStatus.startsWith("Waiting") && (
            <Button variant="ghost" className="w-full" onClick={startLink}>
              <RefreshCw className="h-4 w-4" />
              Generate new code
            </Button>
          )}
        </>
      )}

      {error && (
        <Alert tone="danger" role="alert" className="py-3">
          {error}
        </Alert>
      )}
    </div>
  );
}
