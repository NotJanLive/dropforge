import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths)];
}

// server/dist/config -> project root is ../../../
const envPaths = uniquePaths([
  path.resolve(__dirname, "../../../.env"),
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../.env"),
]);

let loadedFrom: string | null = null;
for (const envPath of envPaths) {
  if (!fs.existsSync(envPath)) continue;
  dotenv.config({ path: envPath });
  if (process.env.ENCRYPTION_KEY?.trim()) {
    loadedFrom = envPath;
    break;
  }
}

export function validateEnvironment(): void {
  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey) {
    const checked = envPaths.map((p) => `${p}${fs.existsSync(p) ? " (exists)" : " (missing)"}`).join("\n  ");
    throw new Error(
      `ENCRYPTION_KEY is missing or empty.\n` +
        `Checked:\n  ${checked}\n` +
        `Add ENCRYPTION_KEY to your project root .env file (64 hex chars).`
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly 64 hex characters (0-9, a-f). Current length: ${encryptionKey.length}.`
    );
  }

  if (loadedFrom) {
    console.log(`Loaded config from ${loadedFrom}`);
  }

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret || sessionSecret.startsWith("change-me")) {
    console.warn("Warning: SESSION_SECRET is missing or still using the placeholder.");
  }
}
