# Dropforge

Dropforge is a self-hosted web dashboard for **Twitch Drops**. It runs a background miner on the server for each user, watches eligible streams, tracks drop progress, and claims rewards automatically.

## What it does

- **Multi-user:** An admin creates accounts; each user links their own Twitch account.
- **Automatic mining:** Finds drop campaigns, picks a suitable live channel, and watches in the background.
- **Live dashboard:** Shows miner status, drop progress, channels, and inventory filters in the browser.
- **Drop lists:** Priority and ignore lists per user to control which games are mined.

## Quick start

1. Copy `.env.example` to `.env` and set:
   - `SESSION_SECRET` — random string for login sessions
   - `ENCRYPTION_KEY` — 64 hex characters for encrypting Twitch tokens
2. Install and build: `npm install && npm run build`
3. Start: `npm start`
4. Open `http://localhost:4700` and complete the admin setup.

## First run

**Admin:** Create the admin account at `/setup/admin`, then manage users from the dashboard.

**User:** Log in with the password from the admin, complete setup (password → Twitch link → optional priority games), then use the dashboard.

## Stack

- **Client:** React, Vite, TypeScript, Tailwind
- **Server:** Express, SQLite, WebSocket
- **Port:** `4700` (configurable via `PORT`)

## Data & reset

All app data is stored in `server/data/dropforge.db`. To reset the instance, stop the app, delete that file (or the Docker volume), restart, and open `/setup/admin` again.

## Note

Automated drop farming may conflict with [Twitch's Terms of Service](https://www.twitch.tv/p/legal/terms-of-service/). Use at your own risk.
