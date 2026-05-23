import { Router } from "express";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, getSiteConfig, updateSiteConfig, persistDb, runRaw } from "../db/index.js";
import { users, type User } from "../db/schema.js";
import { getSessionUser, requireAdmin, requireAuth, requireUser } from "../auth/middleware.js";
import { randomBytes } from "crypto";
import { minerManager } from "../miner/manager.js";
import { encrypt, decrypt } from "../utils/crypto.js";
import {
  normalizeUser,
  normalizeUsername,
  toSqliteBool,
} from "../utils/user.js";

const router = Router();

function findUserByUsername(username: string): User | undefined {
  const normalized = normalizeUsername(username).toLowerCase();
  const match = db
    .select()
    .from(users)
    .all()
    .find((u) => normalizeUsername(u.username).toLowerCase() === normalized);
  return match ? normalizeUser(match) : undefined;
}

function findUserById(id: number): User | undefined {
  const user = db.select().from(users).where(eq(users.id, id)).get();
  return user ? normalizeUser(user) : undefined;
}

function mapUserForAdmin(u: User) {
  const user = normalizeUser(u);
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    setupComplete: user.setupComplete,
    setupStep: user.setupStep,
    createdAt: user.createdAt,
    canRevealPassword: Boolean(user.pendingPasswordEnc),
    passwordMode: user.passwordMode,
  };
}

function publicUser(user: User) {
  const normalized = normalizeUser(user);
  return {
    id: normalized.id,
    username: normalized.username,
    role: normalized.role,
    mustChangePassword: normalized.mustChangePassword,
    setupComplete: normalized.setupComplete,
    setupStep: normalized.setupStep,
  };
}

function generateTempPassword() {
  return randomBytes(6).toString("base64url");
}

router.get("/status", (req, res) => {
  const config = getSiteConfig();
  const user = getSessionUser(req);
  if (req.session.userId && !user) {
    req.session.userId = undefined;
  }
  res.json({
    initialized: config?.initialized ?? false,
    adminSetupComplete: config?.adminSetupComplete ?? false,
    user: user ? publicUser(user) : null,
  });
});

router.post("/setup/admin", async (req, res) => {
  const config = getSiteConfig();
  if (config?.initialized) {
    res.status(400).json({ error: "Already initialized" });
    return;
  }
  const { username, password, priorityMode } = req.body as {
    username?: string;
    password?: string;
    priorityMode?: string;
  };
  if (!username || !password || password.length < 8) {
    res.status(400).json({ error: "Username and password (min 8 chars) required" });
    return;
  }
  const normalizedUsername = normalizeUsername(username);
  const hash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();
  runRaw(
    `INSERT INTO users (username, password_hash, role, must_change_password, setup_complete, setup_step, password_mode, created_at)
     VALUES (?, ?, 'admin', 0, 0, 0, 'permanent', ?)`,
    [normalizedUsername, hash, now]
  );
  const admin = findUserByUsername(normalizedUsername)!;
  updateSiteConfig({
    initialized: true,
    priorityMode: priorityMode ?? "PRIORITY_ONLY",
  });
  req.session.userId = admin.id;
  persistDb();
  res.json({ ok: true, userId: admin.id });
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "Credentials required" });
    return;
  }
  const user = findUserByUsername(username);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  req.session.userId = user.id;
  if (user.role === "user" && user.setupComplete) {
    void minerManager.ensureRunning(user.id).catch(() => undefined);
  }
  res.json({
    ok: true,
    user: publicUser(user),
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.post("/password", requireAuth, async (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (!newPassword || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }
  if (!user.mustChangePassword) {
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(401).json({ error: "Current password incorrect" });
      return;
    }
  }
  const hash = await bcrypt.hash(newPassword, 12);
  runRaw(
    `UPDATE users SET password_hash = ?, must_change_password = 0, pending_password_enc = NULL, password_mode = 'user' WHERE id = ?`,
    [hash, user.id]
  );
  res.json({ ok: true });
});

router.post("/setup/admin/complete-step", requireAdmin, (req, res) => {
  const user = getSessionUser(req)!;
  const { step } = req.body as { step?: number };
  const nextStep = step ?? user.setupStep + 1;
  db.update(users).set({ setupStep: nextStep }).where(eq(users.id, user.id)).run();
  res.json({ ok: true, setupStep: nextStep });
});

router.post("/setup/admin/finish", requireAdmin, (req, res) => {
  const user = getSessionUser(req)!;
  db.update(users).set({ setupComplete: true }).where(eq(users.id, user.id)).run();
  updateSiteConfig({ adminSetupComplete: true });
  persistDb();
  res.json({ ok: true });
});

router.post("/setup/user/complete-step", requireUser, (req, res) => {
  const user = (req as typeof req & { currentUser: typeof users.$inferSelect }).currentUser;
  const { step } = req.body as { step?: number };
  const nextStep = step ?? user.setupStep + 1;
  db.update(users).set({ setupStep: nextStep }).where(eq(users.id, user.id)).run();
  res.json({ ok: true, setupStep: nextStep });
});

router.post("/setup/user/finish", requireUser, async (req, res) => {
  const user = (req as typeof req & { currentUser: typeof users.$inferSelect }).currentUser;
  db.update(users).set({ setupComplete: true }).where(eq(users.id, user.id)).run();
  await minerManager.ensureRunning(user.id).catch(() => undefined);
  res.json({ ok: true });
});

router.get("/users", requireAdmin, (_req, res) => {
  const list = db
    .select()
    .from(users)
    .where(eq(users.role, "user"))
    .all()
    .map((u) => mapUserForAdmin(u));
  res.json({ users: list });
});

router.get("/admin/miners", requireAdmin, (_req, res) => {
  res.json({ miners: minerManager.getAdminUserMinersOverview() });
});

router.post("/users", requireAdmin, async (req, res) => {
  const { username, passwordType, password } = req.body as {
    username?: string;
    passwordType?: "temporary" | "permanent";
    password?: string;
  };
  if (!username) {
    res.status(400).json({ error: "Username required" });
    return;
  }
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) {
    res.status(400).json({ error: "Username required" });
    return;
  }
  if (findUserByUsername(normalizedUsername)) {
    res.status(400).json({ error: "Username already exists" });
    return;
  }

  const isPermanent = passwordType === "permanent";
  let plainPassword: string;
  let mustChangePassword: boolean;
  let pendingPasswordEnc: string | null;

  if (isPermanent) {
    if (!password || password.length < 8) {
      res.status(400).json({ error: "Permanent password must be at least 8 characters" });
      return;
    }
    plainPassword = password;
    mustChangePassword = false;
    pendingPasswordEnc = null;
  } else {
    plainPassword = generateTempPassword();
    mustChangePassword = true;
    pendingPasswordEnc = encrypt(plainPassword);
  }

  const hash = await bcrypt.hash(plainPassword, 12);
  const now = new Date().toISOString();
  runRaw(
    `INSERT INTO users (username, password_hash, role, must_change_password, setup_complete, setup_step, pending_password_enc, password_mode, created_at)
     VALUES (?, ?, 'user', ?, 0, 0, ?, ?, ?)`,
    [
      normalizedUsername,
      hash,
      toSqliteBool(mustChangePassword),
      pendingPasswordEnc,
      isPermanent ? "permanent" : "temporary",
      now,
    ]
  );

  res.json({
    ok: true,
    username: normalizedUsername,
    passwordType: isPermanent ? "permanent" : "temporary",
    password: plainPassword,
    canRevealPassword: !isPermanent,
  });
});

router.get("/users/:id/password", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = findUserById(id);
  if (!user || user.role !== "user") {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!user.pendingPasswordEnc) {
    res.status(404).json({ error: "Password is no longer available" });
    return;
  }
  try {
    res.json({ password: decrypt(user.pendingPasswordEnc) });
  } catch {
    res.status(500).json({ error: "Failed to decrypt password" });
  }
});

router.post("/users/:id/reset-password", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { passwordType, password } = req.body as {
    passwordType?: "temporary" | "permanent";
    password?: string;
  };
  const user = findUserById(id);
  if (!user || user.role !== "user") {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const isPermanent = passwordType === "permanent";
  let plainPassword: string;
  let mustChangePassword: boolean;
  let pendingPasswordEnc: string | null;

  if (isPermanent) {
    if (!password || password.length < 8) {
      res.status(400).json({ error: "Permanent password must be at least 8 characters" });
      return;
    }
    plainPassword = password;
    mustChangePassword = false;
    pendingPasswordEnc = null;
  } else {
    plainPassword = generateTempPassword();
    mustChangePassword = true;
    pendingPasswordEnc = encrypt(plainPassword);
  }

  const hash = await bcrypt.hash(plainPassword, 12);
  runRaw(
    `UPDATE users SET password_hash = ?, must_change_password = ?, pending_password_enc = ?, password_mode = ?, setup_complete = 0, setup_step = 0 WHERE id = ?`,
    [
      hash,
      toSqliteBool(mustChangePassword),
      pendingPasswordEnc,
      isPermanent ? "permanent" : "temporary",
      id,
    ]
  );

  res.json({
    ok: true,
    passwordType: isPermanent ? "permanent" : "temporary",
    password: plainPassword,
    canRevealPassword: !isPermanent,
  });
});

router.delete("/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const user = db.select().from(users).where(eq(users.id, id)).get();
  if (!user || user.role !== "user") {
    res.status(400).json({ error: "Cannot delete this user" });
    return;
  }
  db.delete(users).where(eq(users.id, id)).run();
  persistDb();
  res.json({ ok: true });
});

router.get("/settings/global", requireAdmin, (_req, res) => {
  const config = getSiteConfig();
  res.json({ priorityMode: config?.priorityMode ?? "PRIORITY_ONLY" });
});

router.put("/settings/global", requireAdmin, (req, res) => {
  const { priorityMode } = req.body as { priorityMode?: string };
  if (priorityMode) updateSiteConfig({ priorityMode });
  res.json({ ok: true });
});

export default router;
