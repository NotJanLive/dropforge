import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Shield } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

const POLL_INTERVAL_MS = 1500;

interface TwitchBrowserLinkProps {
  onLinked: () => void | Promise<void>;
  idleHint?: string;
}

export function TwitchBrowserLink({ onLinked, idleHint }: TwitchBrowserLinkProps) {
  const [authorizeUrl, setAuthorizeUrl] = useState("");
  const [browserOpened, setBrowserOpened] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [linked, setLinked] = useState(false);
  const pollId = useRef(0);

  useEffect(
    () => () => {
      pollId.current++;
    },
    []
  );

  const finishLink = async () => {
    pollId.current++;
    setLinked(true);
    await onLinked();
  };

  const pollBrowser = async (id: number) => {
    while (id === pollId.current) {
      const result = await api.twitchLinkPoll();
      if (id !== pollId.current) return;
      if (result.status === "completed") {
        await finishLink();
        return;
      }
      if (result.status === "failed") {
        setBrowserOpened(false);
        setError(`${result.error ?? "Twitch login failed"}. You can still paste the address below.`);
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  };

  const startLink = async () => {
    setError("");
    setLoading(true);
    try {
      const flow = await api.twitchLinkStart();
      setAuthorizeUrl(flow.authorizeUrl);
      setBrowserOpened(flow.browserOpened);
      if (flow.browserOpened) {
        void pollBrowser(++pollId.current).catch((err) => {
          setBrowserOpened(false);
          setError(err instanceof Error ? err.message : "Twitch link failed");
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Twitch link failed");
    } finally {
      setLoading(false);
    }
  };

  const submitRedirectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.twitchLinkComplete(redirectUrl.trim());
      await finishLink();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Twitch link failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!authorizeUrl ? (
        <>
          <div className="flex gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {idleHint ?? "Log in on twitch.tv to authorize Dropforge with your Twitch account."}
            </p>
          </div>
          <Button className="w-full" size="lg" loading={loading} onClick={startLink}>
            Start Twitch authorization
          </Button>
        </>
      ) : linked ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-success/25 bg-success/[0.07] px-3 py-2.5 text-sm text-success">
          <Check className="h-4 w-4" />
          Twitch linked successfully
        </div>
      ) : (
        <>
          {browserOpened && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-sm text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-pulse-ring rounded-full bg-primary" />
                <span className="relative h-2 w-2 rounded-full bg-primary" />
              </span>
              Log in with username and password in the browser window that just opened
            </div>
          )}

          <form className="space-y-3" onSubmit={submitRedirectUrl}>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {browserOpened
                ? "No window? Log in yourself: open Twitch below, then copy the address you end up on."
                : "Open Twitch and log in with username and password. Then copy the address you end up on (it starts with twitch.tv/#access_token=) and paste it here."}
            </p>
            <Button variant="secondary" className="w-full" size="lg" asChild>
              <a href={authorizeUrl} target="_blank" rel="noreferrer">
                Open Twitch login
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <Input
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://www.twitch.tv/#access_token=…"
              aria-label="Address after the Twitch login"
              autoComplete="off"
            />
            <Button type="submit" className="w-full" loading={loading} disabled={!redirectUrl.trim()}>
              Link Twitch account
            </Button>
          </form>
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
