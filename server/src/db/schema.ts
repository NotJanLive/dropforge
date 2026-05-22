import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const siteConfig = sqliteTable("site_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  initialized: integer("initialized", { mode: "boolean" }).notNull().default(false),
  adminSetupComplete: integer("admin_setup_complete", { mode: "boolean" }).notNull().default(false),
  priorityMode: text("priority_mode").notNull().default("PRIORITY_ONLY"),
  createdAt: text("created_at").notNull(),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull(),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  setupComplete: integer("setup_complete", { mode: "boolean" }).notNull().default(false),
  setupStep: integer("setup_step").notNull().default(0),
  pendingPasswordEnc: text("pending_password_enc"),
  passwordMode: text("password_mode", { enum: ["temporary", "permanent", "user"] }).notNull().default("temporary"),
  createdAt: text("created_at").notNull(),
});

export const twitchSessions = sqliteTable("twitch_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  deviceId: text("device_id").notNull(),
  accessTokenEnc: text("access_token_enc").notNull(),
  twitchUserId: text("twitch_user_id").notNull(),
  twitchLogin: text("twitch_login"),
  sessionId: text("session_id").notNull(),
  linkedAt: text("linked_at").notNull(),
});

export const userMinerSettings = sqliteTable("user_miner_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().unique(),
  priorityMode: text("priority_mode").notNull().default("PRIORITY_ONLY"),
  priorityGames: text("priority_games").notNull().default("[]"),
  excludeGames: text("exclude_games").notNull().default("[]"),
  selectedCampaigns: text("selected_campaigns").notNull().default("[]"),
  activeCampaignId: text("active_campaign_id"),
  manualChannelLogin: text("manual_channel_login"),
  updatedAt: text("updated_at").notNull(),
});

export const deviceAuthSessions = sqliteTable("device_auth_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  verificationUri: text("verification_uri").notNull(),
  intervalSec: integer("interval_sec").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status", { enum: ["pending", "completed", "expired", "failed"] }).notNull().default("pending"),
  createdAt: text("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type SiteConfig = typeof siteConfig.$inferSelect;
export type TwitchSession = typeof twitchSessions.$inferSelect;
export type UserMinerSettings = typeof userMinerSettings.$inferSelect;
