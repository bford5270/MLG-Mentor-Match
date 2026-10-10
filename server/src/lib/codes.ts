import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
/** Codes issued per address per window before further requests are silently dropped. */
export const MAX_CODES_PER_WINDOW = 3;
export const CODE_WINDOW_MS = 15 * 60 * 1000;

export function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashCode(secret: string, email: string, code: string): string {
  return createHmac("sha256", secret).update(`${email}:${code}`).digest("hex");
}

export function codeMatches(secret: string, email: string, code: string, storedHash: string): boolean {
  const a = Buffer.from(hashCode(secret, email, code), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
