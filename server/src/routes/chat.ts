// Chat between the two officers of a match. Every route here checks that the
// caller is one of the two participants; there is deliberately no admin or
// approver path to message content anywhere in the API.
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { auditEvents, matches, messageReads, messages, reports, users } from "../db/schema.js";
import type { ChatMessage } from "../lib/hub.js";
import { type AppEnv, requireUser } from "../lib/session.js";

const MAX_BODY = 2000;
const PAGE = 50;
/** Per-user send limit: messages per rolling minute. */
const RATE_LIMIT = 30;

const sendSchema = z.object({ body: z.string().trim().min(1).max(MAX_BODY) });
const reportSchema = z.object({
  description: z.string().trim().min(10).max(2000),
  /** Messages the reporter chooses to share with the G-10. Nothing else is visible to them. */
  attachMessageIds: z.array(z.string().uuid()).max(20).default([]),
});
const endSchema = z.object({ reason: z.string().trim().max(1000).optional() });

export const toChatMessage = (m: typeof messages.$inferSelect): ChatMessage => ({
  id: m.id,
  matchId: m.matchId,
  senderId: m.senderId,
  body: m.body,
  touchpointId: m.touchpointId,
  createdAt: m.createdAt.toISOString(),
});

export function chatRoutes({ db, config, mailer, hub }: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser(db, config));
  const recentSends = new Map<string, number[]>();

  /** The match, if the caller is in it. Same 404 whether it doesn't exist or isn't theirs. */
  async function participantMatch(matchId: string, userId: string) {
    if (!z.string().uuid().safeParse(matchId).success) return undefined;
    const [m] = await db
      .select()
      .from(matches)
      .where(and(eq(matches.id, matchId), or(eq(matches.mentorId, userId), eq(matches.menteeId, userId))));
    // Pending proposals aren't visible to officers yet.
    return m && m.status !== "pending_approval" ? m : undefined;
  }
  const notFound = (c: { json: (b: unknown, s: 404) => Response }) => c.json({ error: "conversation not found" }, 404);
  const participants = (m: typeof matches.$inferSelect) => [m.mentorId, m.menteeId];

  app.get("/:matchId/messages", async (c) => {
    const me = c.get("user");
    const m = await participantMatch(c.req.param("matchId"), me.id);
    if (!m) return notFound(c);
    const before = c.req.query("before");
    const beforeDate = before ? new Date(before) : null;
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.matchId, m.id), beforeDate && !isNaN(+beforeDate) ? lt(messages.createdAt, beforeDate) : undefined))
      .orderBy(desc(messages.createdAt))
      .limit(PAGE + 1);
    const reads = await db.select().from(messageReads).where(eq(messageReads.matchId, m.id));
    const partnerId = m.mentorId === me.id ? m.menteeId : m.mentorId;
    return c.json({
      match: { id: m.id, status: m.status, myRole: m.mentorId === me.id ? "mentor" : "mentee" },
      messages: rows.slice(0, PAGE).reverse().map(toChatMessage),
      hasMore: rows.length > PAGE,
      partnerLastReadAt: reads.find((r) => r.userId === partnerId)?.lastReadAt ?? null,
    });
  });

  app.post("/:matchId/messages", async (c) => {
    const me = c.get("user");
    const m = await participantMatch(c.req.param("matchId"), me.id);
    if (!m) return notFound(c);
    if (m.status !== "active") return c.json({ error: "this match has ended" }, 409);
    const parsed = sendSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: `messages must be 1–${MAX_BODY} characters` }, 400);

    const now = Date.now();
    const window = (recentSends.get(me.id) ?? []).filter((t) => now - t < 60_000);
    if (window.length >= RATE_LIMIT) return c.json({ error: "slow down a little" }, 429);
    recentSends.set(me.id, [...window, now]);

    const [row] = await db.insert(messages).values({ matchId: m.id, senderId: me.id, body: parsed.data.body }).returning();
    await db
      .insert(messageReads)
      .values({ matchId: m.id, userId: me.id, lastReadAt: row.createdAt })
      .onConflictDoUpdate({ target: [messageReads.matchId, messageReads.userId], set: { lastReadAt: row.createdAt } });
    const message = toChatMessage(row);
    hub.publish(participants(m), { type: "message", matchId: m.id, message });
    return c.json({ message });
  });

  app.post("/:matchId/read", async (c) => {
    const me = c.get("user");
    const m = await participantMatch(c.req.param("matchId"), me.id);
    if (!m) return notFound(c);
    const lastReadAt = new Date();
    await db
      .insert(messageReads)
      .values({ matchId: m.id, userId: me.id, lastReadAt })
      .onConflictDoUpdate({ target: [messageReads.matchId, messageReads.userId], set: { lastReadAt } });
    hub.publish(participants(m), { type: "read", matchId: m.id, userId: me.id, lastReadAt: lastReadAt.toISOString() });
    return c.json({ lastReadAt });
  });

  app.post("/:matchId/report", async (c) => {
    const me = c.get("user");
    const m = await participantMatch(c.req.param("matchId"), me.id);
    if (!m) return notFound(c);
    const parsed = reportSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "describe the concern in at least a sentence" }, 400);

    const ids = parsed.data.attachMessageIds;
    const attached = ids.length
      ? await db
          .select()
          .from(messages)
          .where(and(eq(messages.matchId, m.id), inArray(messages.id, ids)))
          .orderBy(messages.createdAt)
      : [];
    const [report] = await db
      .insert(reports)
      .values({
        matchId: m.id,
        reporterId: me.id,
        description: parsed.data.description,
        attachedMessages: attached.map((x) => ({
          sentAt: x.createdAt.toISOString(),
          from: x.senderId === me.id ? "reporter" : x.senderId === null ? "system" : "other officer",
          body: x.body,
        })),
      })
      .returning({ id: reports.id });
    await db.insert(auditEvents).values({ matchId: m.id, actorId: me.id, action: "report", data: { reportId: report.id } });

    // Tell approvers a report exists. The details stay in the app.
    const approvers = await db.select({ email: users.email }).from(users).where(inArray(users.role, ["approver", "admin"]));
    for (const a of approvers) {
      mailer
        .send({
          to: a.email,
          subject: "New report — MLG Mentor Match",
          text: `An officer filed a report about their mentorship match. Open the Match queue to review it:\n\n${config.siteUrl}\n`,
        })
        .catch((err) => console.error("report email failed", err));
    }
    return c.json({ status: "reported" });
  });

  app.post("/:matchId/end", async (c) => {
    const me = c.get("user");
    const m = await participantMatch(c.req.param("matchId"), me.id);
    if (!m) return notFound(c);
    if (m.status !== "active") return c.json({ error: "this match has already ended" }, 409);
    const parsed = endSchema.safeParse(await c.req.json().catch(() => ({})));
    const [ended] = await db
      .update(matches)
      .set({ status: "ended", endedAt: new Date() })
      .where(and(eq(matches.id, m.id), eq(matches.status, "active")))
      .returning({ id: matches.id });
    if (!ended) return c.json({ error: "this match has already ended" }, 409);
    // The reason goes to the audit log for the G-10; the other officer isn't shown it.
    await db.insert(auditEvents).values({
      matchId: m.id,
      actorId: me.id,
      action: "ended_by_officer",
      note: parsed.success ? parsed.data.reason : undefined,
    });
    hub.publish(participants(m), { type: "match_ended", matchId: m.id });
    return c.json({ status: "ended" });
  });

  return app;
}
