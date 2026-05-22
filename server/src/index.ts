import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { initDatabase, initDb } from "./db/index.js";
import authRoutes from "./routes/auth.js";
import twitchRoutes from "./routes/twitch.js";
import { initUiWebSocket } from "./ws/hub.js";
import { minerManager } from "./miner/manager.js";

import { validateEnvironment } from "./config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4700);

async function main() {
  validateEnvironment();
  await initDatabase();
  initDb();

  const app = express();
  const server = createServer(app);

  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: process.env.SESSION_SECRET ?? "dropforge-dev-secret-change-me",
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.use("/api/auth", authRoutes);
  app.use("/api/twitch", twitchRoutes);

  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "dropforge", port: PORT });
  });

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"), (err) => {
      if (err) res.status(404).send("Client not built. Run npm run build.");
    });
  });

  const hub = initUiWebSocket(server, (userId) => minerManager.getStatus(userId));
  minerManager.setBroadcast((userId, status) => {
    hub.broadcastMinerStatus(userId, status);
  });

  server.listen(PORT, async () => {
    console.log(`Dropforge running on http://localhost:${PORT}`);
    await minerManager.startAllEligibleUsers();
  });
}

main().catch((err) => {
  console.error("Failed to start Dropforge:", err);
  process.exit(1);
});
