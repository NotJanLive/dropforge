import initSqlJs, { type Database } from "sql.js";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import * as schema from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
const dbPath = path.join(dataDir, "dropforge.db");

let sqlite: Database | null = null;
let _db: SQLJsDatabase<typeof schema> | null = null;

function persist() {
  if (!sqlite) return;
  fs.writeFileSync(dbPath, Buffer.from(sqlite.export()));
}

export async function initDatabase() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const SQL = await initSqlJs();
  sqlite = fs.existsSync(dbPath)
    ? new SQL.Database(fs.readFileSync(dbPath))
    : new SQL.Database();

  _db = drizzle(sqlite, { schema });

  setInterval(() => persist(), 3000);
  process.on("beforeExit", persist);
  process.on("SIGINT", () => {
    persist();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    persist();
    process.exit(0);
  });
}

function getDb(): SQLJsDatabase<typeof schema> {
  if (!_db) throw new Error("Database not initialized. Call initDatabase() first.");
  return _db;
}

export const db = new Proxy({} as SQLJsDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});

export function initDb() {
  sqlite!.run(`
    CREATE TABLE IF NOT EXISTS site_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      initialized INTEGER NOT NULL DEFAULT 0,
      admin_setup_complete INTEGER NOT NULL DEFAULT 0,
      priority_mode TEXT NOT NULL DEFAULT 'PRIORITY_ONLY',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      must_change_password INTEGER NOT NULL DEFAULT 1,
      setup_complete INTEGER NOT NULL DEFAULT 0,
      setup_step INTEGER NOT NULL DEFAULT 0,
      pending_password_enc TEXT,
      password_mode TEXT NOT NULL DEFAULT 'temporary',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS twitch_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      access_token_enc TEXT NOT NULL,
      twitch_user_id TEXT NOT NULL,
      twitch_login TEXT,
      session_id TEXT NOT NULL,
      linked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_miner_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      priority_mode TEXT NOT NULL DEFAULT 'PRIORITY_ONLY',
      priority_games TEXT NOT NULL DEFAULT '[]',
      exclude_games TEXT NOT NULL DEFAULT '[]',
      selected_campaigns TEXT NOT NULL DEFAULT '[]',
      active_campaign_id TEXT,
      manual_channel_login TEXT,
      miner_logs TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      device_code TEXT NOT NULL,
      user_code TEXT NOT NULL,
      verification_uri TEXT NOT NULL,
      interval_sec INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    );
  `);

  const existing = db.select().from(schema.siteConfig).all();
  if (existing.length === 0) {
    db.insert(schema.siteConfig).values({
      initialized: false,
      adminSetupComplete: false,
      priorityMode: "PRIORITY_ONLY",
      createdAt: new Date().toISOString(),
    }).run();
    persist();
  }

  migrateDb();
}

function migrateDb() {
  try {
    sqlite!.run(`ALTER TABLE users ADD COLUMN pending_password_enc TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    sqlite!.run(`ALTER TABLE users ADD COLUMN password_mode TEXT NOT NULL DEFAULT 'temporary'`);
  } catch {
    /* column already exists */
  }
  try {
    sqlite!.run(`ALTER TABLE user_miner_settings ADD COLUMN active_campaign_id TEXT`);
  } catch {
    /* column already exists */
  }
  try {
    sqlite!.run(`ALTER TABLE user_miner_settings ADD COLUMN miner_logs TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    /* column already exists */
  }
}

export function getSiteConfig() {
  return db.select().from(schema.siteConfig).where(eq(schema.siteConfig.id, 1)).get();
}

export function persistDb() {
  persist();
}

export function runRaw(sql: string, params: (string | number | null)[] = []) {
  if (!sqlite) throw new Error("Database not initialized");
  sqlite.run(sql, params);
  persistDb();
}

export function updateSiteConfig(values: Partial<schema.SiteConfig>) {
  db.update(schema.siteConfig).set(values).where(eq(schema.siteConfig.id, 1)).run();
  persistDb();
}
