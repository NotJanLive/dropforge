## Description

Dropforge is a centralized web dashboard for automatically mining, collecting, and claiming Twitch Drops per user. Each registered user links their Twitch account and configures campaigns; a background miner runs server-side.

## Status: v1 implemented

The first version is a full-stack app (React + Node/Express) on **port 4700**.

### Architecture

```
Dropforge/
├── client/          React 18 + Vite + TypeScript + Tailwind + shadcn/ui
├── server/          Express API, SQLite, miner workers, UI WebSocket
├── .env.example     Configuration template
└── data/            SQLite database (created at runtime)
```

- **Single port:** Express serves the built React app, REST API (`/api/*`), and UI WebSocket (`/ws`).
- **Database:** SQLite via `better-sqlite3` + Drizzle schema in `server/src/db/schema.ts`.
- **Miner:** TypeScript port of [fireph/TwitchDropsMiner](https://github.com/fireph/TwitchDropsMiner) (webui branch), one worker per user with completed setup.

### Getting started

1. Copy `.env.example` to `.env` and set secrets:
   - `SESSION_SECRET` — random string for Dropforge login sessions
   - `ENCRYPTION_KEY` — 64 hex chars (32 bytes) for encrypting Twitch tokens at rest
   - `PORT=4700`
2. Build: `npm install && npm run build`
3. Start: `npm start` (runs `node server/dist/index.js`)
4. Open `http://localhost:4700`

### First-run flows

**Admin (first visit):**
1. `/setup/admin` — create admin username/password + default priority mode
2. `/dashboard` — manage users, global settings

**User (created by admin):**
1. Login with temporary password from admin
2. `/setup/user` — change password → Twitch device link → select campaigns
3. `/dashboard` — overview, campaigns, channels, settings; miner starts automatically

### Twitch authentication (Device Code — no Developer App)

Dropforge uses the **same auth as the reference miner**, not a custom Twitch Developer App:

- Public Android client ID: `kd1unb4b3q4t58fwlpcbzcbnm76a8fp`
- Flow: `GET twitch.tv` (device ID) → `POST id.twitch.tv/oauth2/device` → user enters code at twitch.tv/activate → poll token → validate
- Stored per user (encrypted): `device_id`, `access_token`, `twitch_user_id`, `session_id`
- Config: optional `TWITCH_CLIENT_TYPE=ANDROID_APP|WEB|MOBILE_WEB` in `.env`

**Network requirements:** `gql.twitch.tv`, `id.twitch.tv`, `pubsub-edge.twitch.tv` reachable; do not block `beacon.twitch.tv` on the server network.

### WebSocket connections

| Connection | URL | Purpose |
|------------|-----|---------|
| Twitch PubSub (server) | `wss://pubsub-edge.twitch.tv/v1` | Drop progress, claims, stream up/down, game changes (up to 8 connections, ~199 channels/user) |
| Dropforge UI (browser) | `ws://host:4700/ws?userId=N` | Live dashboard updates (miner status, drop progress) |

**Active PubSub topics per user:**
- `user-drop-events.{user_id}` — progress + auto-claim
- `onsite-notifications.{user_id}` — inventory refresh triggers
- `video-playback-by-id.{channel_id}` — online/offline/viewers
- `broadcast-settings-update.{channel_id}` — game/title changes

### Mining behavior

State loop: `INVENTORY_FETCH → CHANNELS_FETCH → CHANNEL_SWITCH → WATCHING`

- Campaign discovery via GQL (`Inventory`, `Campaigns`, `CampaignDetails`)
- Channel discovery: ACL channels or `GameDirectory` with `DROPS_ENABLED`
- Watch: GQL `sendSpadeEvents` with gzip+base64 `minute-watched` every 59s (no video download)
- Progress: PubSub → GQL `CurrentDrop` fallback
- Claim: PubSub `drop-claim` + GQL `DropsPage_ClaimDropRewards`
- Priority: priority list, exclude list, priority mode; shared live channels preferred; manual channel switch via dashboard

### API overview

| Route | Description |
|-------|-------------|
| `GET /api/auth/status` | Site + session state |
| `POST /api/auth/setup/admin` | Initial admin creation |
| `POST /api/auth/login` | Dropforge login |
| `GET/POST /api/auth/users` | Admin user CRUD |
| `POST /api/twitch/link/start` | Start device code flow |
| `POST /api/twitch/link/poll` | Poll for token |
| `GET /api/twitch/campaigns` | List campaigns |
| `PUT /api/twitch/miner/settings` | Priority/exclude/selection |
| `GET /api/twitch/miner/status` | Miner snapshot |
| `POST /api/twitch/miner/reload` | Restart miner |
| `POST /api/twitch/miner/switch` | Manual channel switch |

### Dashboard sections (shared design, admin/user)

- **Overview** — miner state, current drop progress, PubSub connections
- **Campaigns** — select campaigns, priority/exclude, reload miner
- **Channels** — live status, viewers, manual switch
- **Settings** — password, Twitch re-link, global defaults (admin)
- **Users** (admin) — create users with one-time passwords
- **Twitch Inventory** link — `https://www.twitch.tv/drops/inventory`

### Known limits

- ~199 channels per user (PubSub topic limits)
- GQL rate limit ~5 req/s per worker
- Token expiry requires Twitch re-link (no refresh flow, same as reference miner)
- Automated watching may conflict with Twitch ToS — use at your own risk

## Original spec (reference)

See git history for the original German specification. Language in the UI is English.

## Sources

- [fireph/docker-twitch-drops-miner](https://github.com/fireph/docker-twitch-drops-miner)
- [fireph/TwitchDropsMiner](https://github.com/fireph/TwitchDropsMiner) (webui branch)
