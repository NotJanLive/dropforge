import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { getClientType, CLIENT_TYPES } from "../miner/constants.js";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 500;
/** The ANDROID_APP client only accepts this exact redirect URL. */
const TOKEN_REDIRECT_PREFIX = "https://www.twitch.tv/#access_token=";

export type BrowserLoginState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "completed"; accessToken: string }
  | { status: "failed"; error: string };

interface BrowserLogin {
  state: BrowserLoginState;
  browser: ChildProcess;
  timer: NodeJS.Timeout;
}

const logins = new Map<number, BrowserLogin>();

/** Twitch's implicit grant flow (TDM #1205). Device codes no longer work for this client. */
export function buildAuthorizeUrl(): string {
  const client = getClientType();
  if (client.clientId !== CLIENT_TYPES.ANDROID_APP.clientId) {
    throw new Error("Twitch login has only been tested for the ANDROID_APP client");
  }
  const params = new URLSearchParams({
    client_id: client.clientId,
    response_type: "token",
    redirect_uri: "https://www.twitch.tv/",
  });
  return `https://id.twitch.tv/oauth2/authorize?${params}`;
}

/** Pull the token out of the URL Twitch redirects to after the login. */
export function extractAccessToken(redirectUrl: string): string | null {
  return redirectUrl.match(/[#&]access_token=(\w+)/i)?.[1] ?? null;
}

function findBrowser(): string | null {
  if (process.platform === "linux" && !process.env.DISPLAY) return null;
  const candidates: string[] = [];
  if (process.platform === "win32") {
    for (const root of [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ]) {
      if (!root) continue;
      candidates.push(
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(root, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  } else {
    candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser");
  }
  return candidates.find((file) => fs.existsSync(file)) ?? null;
}

async function readTabUrls(profileDir: string): Promise<string[]> {
  // Chrome picks a free port and writes it to this file once it is ready.
  const portFile = path.join(profileDir, "DevToolsActivePort");
  if (!fs.existsSync(portFile)) return [];
  const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
  if (!port) return [];
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) return [];
  const tabs = (await res.json()) as Array<{ type: string; url: string }>;
  return tabs.filter((tab) => tab.type === "page").map((tab) => tab.url);
}

function finish(login: BrowserLogin, state: BrowserLoginState) {
  if (login.state.status !== "pending") return;
  login.state = state;
  clearTimeout(login.timer);
  login.browser.kill();
}

/** Opens a visible browser on this machine. Returns false when there is none to open. */
export function startBrowserLogin(userId: number): boolean {
  cancelBrowserLogin(userId);
  const browserPath = findBrowser();
  if (!browserPath) return false;

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "dropforge-twitch-"));
  const browser = spawn(
    browserPath,
    [
      `--user-data-dir=${profileDir}`,
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      buildAuthorizeUrl(),
    ],
    { stdio: "ignore" }
  );

  const login: BrowserLogin = {
    state: { status: "pending" },
    browser,
    timer: setTimeout(() => {
      finish(login, { status: "failed", error: "Twitch login timed out" });
    }, LOGIN_TIMEOUT_MS),
  };
  logins.set(userId, login);

  const poll = async () => {
    while (login.state.status === "pending") {
      try {
        const redirected = (await readTabUrls(profileDir)).find((url) =>
          url.startsWith(TOKEN_REDIRECT_PREFIX)
        );
        const accessToken = redirected ? extractAccessToken(redirected) : null;
        if (accessToken) {
          finish(login, { status: "completed", accessToken });
          return;
        }
      } catch {
        /* browser still starting or just closed — the exit handler covers the latter */
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  };
  void poll();

  browser.on("error", (err) => {
    finish(login, { status: "failed", error: err.message });
  });
  browser.on("exit", () => {
    finish(login, {
      status: "failed",
      error: "The browser window was closed before the login finished",
    });
    // Chrome keeps its profile locked until the process is gone.
    fs.rm(profileDir, { recursive: true, force: true, maxRetries: 5 }, () => undefined);
  });
  return true;
}

export function getBrowserLoginState(userId: number): BrowserLoginState {
  return logins.get(userId)?.state ?? { status: "idle" };
}

export function cancelBrowserLogin(userId: number) {
  const login = logins.get(userId);
  if (!login) return;
  finish(login, { status: "failed", error: "Twitch login cancelled" });
  logins.delete(userId);
}
