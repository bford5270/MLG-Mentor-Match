import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import type { Db } from "../app.js";
import type { Config } from "../config.js";
import { users } from "../db/schema.js";

export const SESSION_COOKIE = "mlg_session";
const SESSION_TTL_S = 30 * 24 * 60 * 60;

export type User = typeof users.$inferSelect;
export type Role = User["role"];

export type AppEnv = { Variables: { user: User } };

export async function startSession(c: Context, config: Config, userId: string) {
  const token = await sign(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_S },
    config.sessionSecret,
    "HS256",
  );
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.production,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_S,
  });
}

export function endSession(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Returns the user id from a session token, or null if it's missing, forged or expired. */
export async function userIdFromToken(config: Config, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const payload = await verify(token, config.sessionSecret, "HS256");
    return String(payload.sub);
  } catch {
    return null;
  }
}

/** Loads the signed-in user on every request so role changes apply immediately. */
export function requireUser(db: Db, config: Config): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const userId = await userIdFromToken(config, getCookie(c, SESSION_COOKIE));
    if (!userId) return c.json({ error: "not signed in" }, 401);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return c.json({ error: "not signed in" }, 401);
    c.set("user", user);
    await next();
  };
}

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}
