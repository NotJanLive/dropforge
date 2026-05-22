import type { User } from "../db/schema.js";

export function normalizeUsername(username: string): string {
  return username.trim();
}

export function fromSqliteBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function toSqliteBool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function normalizeUser(user: User): User {
  return {
    ...user,
    mustChangePassword: fromSqliteBool(user.mustChangePassword),
    setupComplete: fromSqliteBool(user.setupComplete),
  };
}

export function usersMatch(a: string, b: string): boolean {
  return normalizeUsername(a).toLowerCase() === normalizeUsername(b).toLowerCase();
}
