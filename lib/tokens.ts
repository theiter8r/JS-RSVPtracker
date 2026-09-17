import { randomBytes } from "node:crypto";

/** 32 random bytes, base64url — unguessable, URL-safe, no padding. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isExpired(expiresAt: Date | string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}
