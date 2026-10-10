import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { loginCodes, roster, users } from "../db/schema.js";
import {
  CODE_TTL_MS,
  CODE_WINDOW_MS,
  MAX_ATTEMPTS,
  MAX_CODES_PER_WINDOW,
  codeMatches,
  generateCode,
  hashCode,
  normalizeEmail,
} from "../lib/codes.js";
import { endSession, startSession } from "../lib/session.js";

const emailSchema = z.object({ email: z.string().trim().email().max(254) });
const verifySchema = emailSchema.extend({ code: z.string().regex(/^\d{6}$/) });

export function authRoutes({ db, mailer, config }: Deps) {
  const app = new Hono();

  async function mayRegister(email: string) {
    if (config.adminEmails.includes(email)) return true;
    const [entry] = await db
      .select({ id: roster.id })
      .from(roster)
      .where(and(eq(roster.email, email), eq(roster.active, true)));
    return Boolean(entry);
  }

  // Always answers the same way, so it can't be used to probe the roster.
  app.post("/request-code", async (c) => {
    const parsed = emailSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "enter a valid email address" }, 400);
    const email = normalizeEmail(parsed.data.email);
    const ok = { status: "sent" as const };

    if (!(await mayRegister(email))) return c.json(ok);

    const [{ recent }] = await db
      .select({ recent: sql<number>`count(*)::int` })
      .from(loginCodes)
      .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, new Date(Date.now() - CODE_WINDOW_MS))));
    if (recent >= MAX_CODES_PER_WINDOW) return c.json(ok);

    const code = generateCode();
    await db.insert(loginCodes).values({
      email,
      codeHash: hashCode(config.sessionSecret, email, code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    });
    try {
      await mailer.send({
        to: email,
        subject: `${code} is your MLG Mentor Match sign-in code`,
        text: `Your sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`,
      });
    } catch (err) {
      console.error("sign-in email failed", err);
    }
    return c.json(ok);
  });

  app.post("/verify", async (c) => {
    const parsed = verifySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "enter the 6-digit code" }, 400);
    const email = normalizeEmail(parsed.data.email);
    const invalid = () => c.json({ error: "that code is invalid or expired" }, 400);

    const [pending] = await db
      .select()
      .from(loginCodes)
      .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt), gt(loginCodes.expiresAt, new Date())))
      .orderBy(desc(loginCodes.createdAt))
      .limit(1);
    if (!pending || pending.attempts >= MAX_ATTEMPTS) return invalid();

    if (!codeMatches(config.sessionSecret, email, parsed.data.code, pending.codeHash)) {
      await db
        .update(loginCodes)
        .set({ attempts: pending.attempts + 1 })
        .where(eq(loginCodes.id, pending.id));
      return invalid();
    }
    // Re-check: the officer may have been removed from the roster since the code went out.
    if (!(await mayRegister(email))) return invalid();

    await db.update(loginCodes).set({ consumedAt: new Date() }).where(eq(loginCodes.id, pending.id));

    const isAdmin = config.adminEmails.includes(email);
    let [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ email, role: isAdmin ? "admin" : "officer" })
        .returning();
    } else if (isAdmin && user.role !== "admin") {
      [user] = await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id)).returning();
    }

    await startSession(c, config, user.id);
    return c.json({ status: "signed_in" });
  });

  app.post("/logout", (c) => {
    endSession(c);
    return c.json({ status: "signed_out" });
  });

  return app;
}
