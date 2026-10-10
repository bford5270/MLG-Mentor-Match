import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Db, Deps } from "../app.js";
import { auditEvents, matches, reports } from "../db/schema.js";
import { alternatesFor, type Candidate, hardRuleViolation, proposeBatch, scorePair } from "../domain/matching.js";
import { expirePending, loadCandidates, loadMatchState } from "../domain/store.js";
import { type AppEnv, requireRole, requireUser } from "../lib/session.js";

type State = Awaited<ReturnType<typeof loadMatchState>>;

/** What the approver sees about each officer. No contact details. */
const summary = (c: Candidate) => ({
  userId: c.userId,
  name: c.name,
  service: c.service,
  grade: c.grade,
  mosOrDesignator: c.mosOrDesignator,
  unit: c.unit,
  section: c.section,
  prd: c.prd,
  mentorshipRole: c.mentorshipRole,
  careerGoals: c.careerGoals,
});

/** Checks a specific pairing (manual match or reassignment) against every rule. */
function pairError(state: State, byId: Map<string, Candidate>, mentorId: string, menteeId: string, freedMatchId?: string): string | null {
  const mentor = byId.get(mentorId);
  const mentee = byId.get(menteeId);
  if (!mentor || !mentee) return "officer not found or profile incomplete";
  const violation = hardRuleViolation(mentor, mentee, state.ctx);
  if (violation) return violation;
  const open = state.open.filter((m) => m.id !== freedMatchId);
  if (open.some((m) => m.menteeId === menteeId)) return "mentee already has a mentor";
  if (open.filter((m) => m.mentorId === mentorId).length >= mentor.mentorCapacity) return "mentor is at capacity";
  if (open.some((m) => [m.mentorId, m.menteeId].sort().join(":") === [mentorId, menteeId].sort().join(":"))) {
    return "these officers are already paired";
  }
  return null;
}

const audit = (db: Db, matchId: string | null, actorId: string, action: string, extra: { note?: string; data?: unknown } = {}) =>
  db.insert(auditEvents).values({ matchId, actorId, action, ...extra });

const reassignSchema = z
  .object({
    newMentorId: z.string().uuid().optional(),
    newMenteeId: z.string().uuid().optional(),
    closeActive: z.boolean().default(false),
  })
  .refine((b) => Boolean(b.newMentorId) !== Boolean(b.newMenteeId), "replace exactly one side");

const manualSchema = z.object({ mentorId: z.string().uuid(), menteeId: z.string().uuid() });
const noteSchema = z.object({ note: z.string().trim().max(500).optional() });

export function matchingRoutes({ db, mailer, config, hub }: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser(db, config), requireRole("approver", "admin"));

  app.get("/overview", async (c) => {
    await expirePending(db, null);
    const [candidates, state] = await Promise.all([loadCandidates(db), loadMatchState(db)]);
    const byId = new Map(candidates.map((x) => [x.userId, x]));

    const pending = state.open
      .filter((m) => m.status === "pending_approval")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Alternates exclude anyone already spoken for, so "use this one" will succeed.
    const busyMentees = new Set(state.open.map((m) => m.menteeId));
    const fullMentors = new Set(
      candidates.filter((x) => (state.mentorLoad.get(x.userId) ?? 0) >= x.mentorCapacity).map((x) => x.userId),
    );

    const queue = pending.flatMap((m) => {
      const mentor = byId.get(m.mentorId);
      const mentee = byId.get(m.menteeId);
      if (!mentor || !mentee) return [];
      const others = new Set([mentor.userId, mentee.userId]);
      const mentorAlts = alternatesFor(mentee, "mentor", candidates, state.ctx, new Set([...others, ...fullMentors]));
      const menteeAlts = alternatesFor(mentor, "mentee", candidates, state.ctx, new Set([...others, ...busyMentees]));
      const toAlt = (a: (typeof mentorAlts)[number]) => ({ ...summary(a.candidate), score: a.score, reasons: a.reasons, crossService: a.crossService });
      return [
        {
          id: m.id,
          createdAt: m.createdAt,
          score: m.score,
          reasons: m.reasons,
          crossService: m.crossService,
          mentor: summary(mentor),
          mentee: summary(mentee),
          alternates: { mentor: mentorAlts.map(toAlt), mentee: menteeAlts.map(toAlt) },
        },
      ];
    });

    const active = state.open
      .filter((m) => m.status === "active")
      .flatMap((m) => {
        const mentor = byId.get(m.mentorId);
        const mentee = byId.get(m.menteeId);
        return mentor && mentee ? [{ id: m.id, approvedAt: m.approvedAt, endsOn: m.endsOn, crossService: m.crossService, mentor: summary(mentor), mentee: summary(mentee) }] : [];
      });

    const unmatchedMentees = candidates.filter((x) => x.mentorshipRole !== "mentor" && !busyMentees.has(x.userId));
    const openMentors = candidates.filter((x) => x.mentorshipRole !== "mentee" && !fullMentors.has(x.userId));
    const [lastRun] = await db
      .select({ createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(eq(auditEvents.action, "batch_run"))
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);

    return c.json({
      queue,
      active,
      unmatchedMentees: unmatchedMentees.map(summary),
      openMentors: openMentors.map(summary),
      lastRunAt: lastRun?.createdAt ?? null,
    });
  });

  app.post("/run", async (c) => {
    const actor = c.get("user");
    const expired = await expirePending(db, actor.id);
    const [candidates, state] = await Promise.all([loadCandidates(db), loadMatchState(db)]);
    const proposals = proposeBatch({ candidates, ...state });
    if (proposals.length) {
      await db.insert(matches).values(
        proposals.map((p) => ({ mentorId: p.mentorId, menteeId: p.menteeId, score: p.score, reasons: p.reasons, crossService: p.crossService })),
      );
    }
    await audit(db, null, actor.id, "batch_run", {
      data: { proposed: proposals.length, crossService: proposals.filter((p) => p.crossService).length, expired },
    });
    return c.json({ proposed: proposals.length, crossService: proposals.filter((p) => p.crossService).length, expired });
  });

  app.post("/manual", async (c) => {
    const parsed = manualSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "choose a mentor and a mentee" }, 400);
    const { mentorId, menteeId } = parsed.data;
    const [candidates, state] = await Promise.all([loadCandidates(db), loadMatchState(db)]);
    const byId = new Map(candidates.map((x) => [x.userId, x]));
    const error = pairError(state, byId, mentorId, menteeId);
    if (error) return c.json({ error }, 409);
    const mentor = byId.get(mentorId)!;
    const mentee = byId.get(menteeId)!;
    const [created] = await db
      .insert(matches)
      .values({ mentorId, menteeId, crossService: mentor.service !== mentee.service, ...scorePair(mentor, mentee) })
      .returning();
    await audit(db, created.id, c.get("user").id, "manual_match");
    return c.json({ match: created });
  });

  async function getMatch(id: string) {
    if (!z.string().uuid().safeParse(id).success) return undefined;
    const [m] = await db.select().from(matches).where(eq(matches.id, id));
    return m;
  }

  app.post("/matches/:id/approve", async (c) => {
    const m = await getMatch(c.req.param("id"));
    if (!m) return c.json({ error: "match not found" }, 404);
    if (m.status !== "pending_approval") return c.json({ error: `match is ${m.status}` }, 409);
    const candidates = await loadCandidates(db);
    const byId = new Map(candidates.map((x) => [x.userId, x]));
    const mentor = byId.get(m.mentorId);
    const mentee = byId.get(m.menteeId);
    if (!mentor || !mentee) return c.json({ error: "one of these officers is no longer eligible" }, 409);

    const endsOn = mentor.prd < mentee.prd ? mentor.prd : mentee.prd;
    const [updated] = await db
      .update(matches)
      .set({ status: "active", approvedBy: c.get("user").id, approvedAt: new Date(), endsOn })
      .where(and(eq(matches.id, m.id), eq(matches.status, "pending_approval")))
      .returning();
    if (!updated) return c.json({ error: "match changed; refresh and try again" }, 409);
    await audit(db, m.id, c.get("user").id, "approve");

    // Notify both. Email carries no names or details — just a nudge to open the app.
    const emails = await db.query.users.findMany({ where: (u, { inArray }) => inArray(u.id, [m.mentorId, m.menteeId]) });
    for (const u of emails) {
      const role = u.id === m.mentorId ? "a mentee" : "a mentor";
      mailer
        .send({
          to: u.email,
          subject: "You've been matched — MLG Mentor Match",
          text: `You've been paired with ${role}. Open the app to meet them and get started:\n\n${config.siteUrl}\n`,
        })
        .catch((err) => console.error("match email failed", err));
    }
    return c.json({ match: updated });
  });

  app.post("/matches/:id/reject", async (c) => {
    const body = noteSchema.safeParse(await c.req.json().catch(() => ({})));
    const m = await getMatch(c.req.param("id"));
    if (!m) return c.json({ error: "match not found" }, 404);
    if (m.status !== "pending_approval") return c.json({ error: `match is ${m.status}` }, 409);
    await db.update(matches).set({ status: "rejected", endedAt: new Date() }).where(eq(matches.id, m.id));
    await audit(db, m.id, c.get("user").id, "reject", { note: body.success ? body.data.note : undefined });
    return c.json({ status: "rejected" });
  });

  app.post("/matches/:id/defer", async (c) => {
    const body = noteSchema.safeParse(await c.req.json().catch(() => ({})));
    const m = await getMatch(c.req.param("id"));
    if (!m) return c.json({ error: "match not found" }, 404);
    if (m.status !== "pending_approval") return c.json({ error: `match is ${m.status}` }, 409);
    await audit(db, m.id, c.get("user").id, "defer", { note: body.success ? body.data.note : undefined });
    return c.json({ status: "deferred" });
  });

  app.post("/matches/:id/reassign", async (c) => {
    const parsed = reassignSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "choose one replacement officer" }, 400);
    const m = await getMatch(c.req.param("id"));
    if (!m) return c.json({ error: "match not found" }, 404);
    if (m.status === "active" && !parsed.data.closeActive) {
      return c.json({ error: "this match is active; confirm to end it", requiresConfirmation: true }, 409);
    }
    if (m.status !== "pending_approval" && m.status !== "active") return c.json({ error: `match is ${m.status}` }, 409);

    const mentorId = parsed.data.newMentorId ?? m.mentorId;
    const menteeId = parsed.data.newMenteeId ?? m.menteeId;
    const [candidates, state] = await Promise.all([loadCandidates(db), loadMatchState(db)]);
    const byId = new Map(candidates.map((x) => [x.userId, x]));
    const error = pairError(state, byId, mentorId, menteeId, m.id);
    if (error) return c.json({ error }, 409);

    const mentor = byId.get(mentorId)!;
    const mentee = byId.get(menteeId)!;
    const actorId = c.get("user").id;
    const created = await db.transaction(async (tx) => {
      const closed = await tx
        .update(matches)
        .set({ status: "reassigned", endedAt: new Date() })
        .where(and(eq(matches.id, m.id), eq(matches.status, m.status)))
        .returning({ id: matches.id });
      if (!closed.length) return null;
      const [row] = await tx
        .insert(matches)
        .values({ mentorId, menteeId, previousMatchId: m.id, crossService: mentor.service !== mentee.service, ...scorePair(mentor, mentee) })
        .returning();
      await tx.insert(auditEvents).values([
        { matchId: m.id, actorId, action: "reassign", data: { newMatchId: row.id, wasActive: m.status === "active" } },
        { matchId: row.id, actorId, action: "created_by_reassign", data: { previousMatchId: m.id } },
      ]);
      return row;
    });
    if (!created) return c.json({ error: "match changed; refresh and try again" }, 409);
    return c.json({ match: created });
  });

  app.get("/reports", async (c) => {
    const rows = await db.select().from(reports).orderBy(desc(reports.createdAt)).limit(100);
    const candidates = await loadCandidates(db);
    const byId = new Map(candidates.map((x) => [x.userId, x]));
    const matchRows = rows.length
      ? await db.query.matches.findMany({ where: (m, { inArray }) => inArray(m.id, [...new Set(rows.map((r) => r.matchId))]) })
      : [];
    return c.json({
      reports: rows.map((r) => {
        const m = matchRows.find((x) => x.id === r.matchId);
        const mentor = m && byId.get(m.mentorId);
        const mentee = m && byId.get(m.menteeId);
        const reporter = byId.get(r.reporterId);
        return {
          id: r.id,
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt,
          description: r.description,
          attachedMessages: r.attachedMessages ?? [],
          reporter: reporter && summary(reporter),
          match: m && { id: m.id, status: m.status, mentor: mentor && summary(mentor), mentee: mentee && summary(mentee) },
        };
      }),
    });
  });

  app.post("/reports/:id/resolve", async (c) => {
    const id = c.req.param("id");
    if (!z.string().uuid().safeParse(id).success) return c.json({ error: "report not found" }, 404);
    const [r] = await db
      .update(reports)
      .set({ resolvedAt: new Date(), resolvedBy: c.get("user").id })
      .where(eq(reports.id, id))
      .returning({ id: reports.id, matchId: reports.matchId });
    if (!r) return c.json({ error: "report not found" }, 404);
    await audit(db, r.matchId, c.get("user").id, "report_resolved", { data: { reportId: r.id } });
    return c.json({ status: "resolved" });
  });

  /** The G-10 can end an active match (e.g. after a report). Ended pairs are never re-proposed. */
  app.post("/matches/:id/end", async (c) => {
    const body = noteSchema.safeParse(await c.req.json().catch(() => ({})));
    const m = await getMatch(c.req.param("id"));
    if (!m) return c.json({ error: "match not found" }, 404);
    if (m.status !== "active") return c.json({ error: `match is ${m.status}` }, 409);
    await db.update(matches).set({ status: "ended", endedAt: new Date() }).where(eq(matches.id, m.id));
    await audit(db, m.id, c.get("user").id, "ended_by_approver", { note: body.success ? body.data.note : undefined });
    hub.publish([m.mentorId, m.menteeId], { type: "match_ended", matchId: m.id });
    return c.json({ status: "ended" });
  });

  return app;
}
