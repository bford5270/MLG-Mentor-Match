// Background jobs: touch-point delivery, unread-message email fallback, PRD
// auto-end, retention purge and the weekly digest. Each job is a plain
// function taking `now`, so tests can drive time; the scheduler at the
// bottom runs them on an interval.
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Deps } from "../app.js";
import {
  auditEvents,
  loginCodes,
  matchFeedback,
  matches,
  messages,
  reports,
  settings,
  touchpointDeliveries,
  touchpoints,
  users,
} from "../db/schema.js";
import { toChatMessage } from "../routes/chat.js";
import { pushToUsers } from "../lib/notify.js";
import { CURRICULUM, formatTouchpoint } from "./curriculum.js";

export const RETENTION_DAYS = 30;
export const UNREAD_EMAIL_AFTER_HOURS = 2;
const TIME_ZONE = "America/Los_Angeles";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86400_000);

/** Local hour and weekday at Camp Pendleton. */
export function localTime(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")), weekday: get("weekday"), date: `${get("year")}-${get("month")}-${get("day")}` };
}

/** No pushes in the middle of the night. */
export const withinWakingHours = (now: Date) => {
  const { hour } = localTime(now);
  return hour >= 7 && hour < 20;
};

export async function seedTouchpoints({ db }: Pick<Deps, "db">) {
  await db
    .insert(touchpoints)
    .values(CURRICULUM.map((t) => ({ ...t, active: true })))
    .onConflictDoNothing();
}

/** Posts every touch point that has come due into the pair's chat. */
export async function deliverDueTouchpoints(deps: Deps, now: Date, onlyMatchId?: string) {
  const { db, hub, pusher } = deps;
  const active = await db
    .select()
    .from(matches)
    .where(and(eq(matches.status, "active"), isNotNull(matches.approvedAt), onlyMatchId ? eq(matches.id, onlyMatchId) : undefined));
  if (!active.length) return 0;
  const tps = await db.select().from(touchpoints).where(eq(touchpoints.active, true)).orderBy(touchpoints.sequence);
  const delivered = await db.select().from(touchpointDeliveries).where(inArray(touchpointDeliveries.matchId, active.map((m) => m.id)));
  const done = new Set(delivered.map((d) => `${d.matchId}:${d.touchpointId}`));
  const today = isoDate(now);
  let count = 0;

  for (const m of active) {
    for (const tp of tps) {
      if (done.has(`${m.id}:${tp.id}`)) continue;
      let due = false;
      if (tp.offsetDays !== null) {
        due = addDays(m.approvedAt!, tp.offsetDays) <= now;
        // Don't fire a scheduled touch point after the match's end date.
        if (m.endsOn && isoDate(addDays(m.approvedAt!, tp.offsetDays)) > m.endsOn) due = false;
      } else if (tp.daysBeforeEnd !== null && m.endsOn) {
        due = isoDate(addDays(new Date(`${m.endsOn}T00:00:00Z`), -tp.daysBeforeEnd)) <= today && today <= m.endsOn;
      }
      if (!due) continue;

      // Several can come due in one tick; offset by a millisecond each so they sort in sequence.
      const at = new Date(now.getTime() + count);
      const inserted = await db.transaction(async (tx) => {
        const claim = await tx
          .insert(touchpointDeliveries)
          .values({ matchId: m.id, touchpointId: tp.id, deliveredAt: at })
          .onConflictDoNothing()
          .returning();
        if (!claim.length) return null; // Another instance got it.
        const [msg] = await tx
          .insert(messages)
          .values({ matchId: m.id, senderId: null, body: formatTouchpoint(tp), touchpointId: tp.id, createdAt: at })
          .returning();
        return msg;
      });
      if (!inserted) continue;
      count++;
      hub.publish([m.mentorId, m.menteeId], { type: "message", matchId: m.id, message: toChatMessage(inserted) });
      await pushToUsers(db, pusher, [m.mentorId, m.menteeId], {
        title: "New mentorship touch point",
        body: tp.title,
        url: "/",
        tag: `tp-${m.id}`,
      });
    }
  }
  return count;
}

/** Emails officers who have had unread messages for a while (at most daily). No content in the email. */
export async function sendUnreadEmails(deps: Deps, now: Date) {
  const { db, mailer, config } = deps;
  const olderThan = new Date(now.getTime() - UNREAD_EMAIL_AFTER_HOURS * 3600_000);
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const rows = await db.execute<{ id: string; email: string }>(sql`
    select distinct u.id, u.email
    from users u
    join matches m on m.status = 'active' and (m.mentor_id = u.id or m.mentee_id = u.id)
    join messages msg on msg.match_id = m.id and (msg.sender_id is null or msg.sender_id <> u.id)
    left join message_reads r on r.match_id = m.id and r.user_id = u.id
    where (r.last_read_at is null or msg.created_at > r.last_read_at)
      and msg.created_at < ${olderThan.toISOString()}::timestamptz
      and (u.last_unread_email_at is null
           or (u.last_unread_email_at < ${dayAgo.toISOString()}::timestamptz and msg.created_at > u.last_unread_email_at))
  `);
  for (const u of rows) {
    await db.update(users).set({ lastUnreadEmailAt: now }).where(eq(users.id, u.id));
    await mailer
      .send({
        to: u.email,
        subject: "You have unread messages — MLG Mentor Match",
        text: `You have unread messages in MLG Mentor Match. Open the app to read them:\n\n${config.siteUrl}\n\nTip: add the app to your Home Screen and turn on notifications to hear about new messages right away.`,
      })
      .catch((err) => console.error("unread email failed", err));
  }
  return rows.length;
}

/** Ends active matches whose end date (the earlier PRD) has passed. */
export async function endMatchesPastPrd(deps: Deps, now: Date) {
  const { db, hub } = deps;
  const today = localTime(now).date;
  const due = await db
    .update(matches)
    .set({ status: "ended", endedAt: now })
    .where(and(eq(matches.status, "active"), lt(matches.endsOn, today)))
    .returning();
  for (const m of due) {
    const [msg] = await db
      .insert(messages)
      .values({
        matchId: m.id,
        senderId: null,
        body: "This mentorship has reached its end date (the earlier of your PRDs). Thank you both. Please take a minute to share feedback from the home screen.",
        createdAt: now,
      })
      .returning();
    await db.insert(auditEvents).values({ matchId: m.id, actorId: null, action: "ended_prd" });
    hub.publish([m.mentorId, m.menteeId], { type: "message", matchId: m.id, message: toChatMessage(msg) });
    hub.publish([m.mentorId, m.menteeId], { type: "match_ended", matchId: m.id });
  }
  return due.length;
}

/** Deletes chat content 30 days after a match closes, and stale sign-in codes. */
export async function purgeOldData({ db }: Pick<Deps, "db">, now: Date) {
  const cutoff = addDays(now, -RETENTION_DAYS);
  const closed = db
    .select({ id: matches.id })
    .from(matches)
    .where(and(inArray(matches.status, ["ended", "reassigned"]), lt(matches.endedAt, cutoff)));
  const purged = await db.delete(messages).where(inArray(messages.matchId, closed)).returning({ id: messages.id });
  await db.delete(loginCodes).where(lt(loginCodes.createdAt, addDays(now, -1)));
  return purged.length;
}

export async function buildDigest({ db }: Pick<Deps, "db">, now: Date) {
  const weekAgo = addDays(now, -7);
  const count = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const n = sql<number>`count(*)::int`;

  const pending = await db.select({ createdAt: matches.createdAt }).from(matches).where(eq(matches.status, "pending_approval"));
  const oldestPendingDays = pending.length
    ? Math.floor((now.getTime() - Math.min(...pending.map((p) => p.createdAt.getTime()))) / 86400_000)
    : 0;
  const stats = {
    pending: pending.length,
    oldestPendingDays,
    active: await count(db.select({ n }).from(matches).where(eq(matches.status, "active"))),
    approvedThisWeek: await count(db.select({ n }).from(matches).where(gte(matches.approvedAt, weekAgo))),
    endedThisWeek: await count(db.select({ n }).from(matches).where(and(inArray(matches.status, ["ended", "reassigned"]), gte(matches.endedAt, weekAgo)))),
    openReports: await count(db.select({ n }).from(reports).where(isNull(reports.resolvedAt))),
    newOfficers: await count(db.select({ n }).from(users).where(gte(users.createdAt, weekAgo))),
    touchpointsDelivered: await count(db.select({ n }).from(touchpointDeliveries).where(gte(touchpointDeliveries.deliveredAt, weekAgo))),
    touchpointsDiscussed: await count(db.select({ n }).from(touchpointDeliveries).where(gte(touchpointDeliveries.discussedAt, weekAgo))),
    feedbackThisWeek: await count(db.select({ n }).from(matchFeedback).where(gte(matchFeedback.createdAt, weekAgo))),
  };

  const lines = [
    "MLG Mentor Match — weekly summary",
    "",
    `Waiting for approval: ${stats.pending}${stats.pending ? ` (oldest ${stats.oldestPendingDays} days; proposals expire at 14)` : ""}`,
    `Open reports: ${stats.openReports}`,
    `Active matches: ${stats.active}`,
    "",
    "Last 7 days:",
    `  New officers signed up: ${stats.newOfficers}`,
    `  Matches approved: ${stats.approvedThisWeek}`,
    `  Matches ended: ${stats.endedThisWeek}`,
    `  Touch points delivered: ${stats.touchpointsDelivered} (marked discussed: ${stats.touchpointsDiscussed})`,
    `  Feedback received: ${stats.feedbackThisWeek}`,
  ];
  return { stats, text: lines.join("\n") };
}

export async function sendDigest(deps: Deps, now: Date) {
  const { db, mailer, config } = deps;
  const { text } = await buildDigest(deps, now);
  const recipients = await db.select({ email: users.email }).from(users).where(inArray(users.role, ["approver", "admin"]));
  for (const r of recipients) {
    await mailer
      .send({ to: r.email, subject: "Weekly summary — MLG Mentor Match", text: `${text}\n\nOpen the Match queue: ${config.siteUrl}\n` })
      .catch((err) => console.error("digest email failed", err));
  }
  return recipients.length;
}

async function getMarker(db: Deps["db"], key: string) {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as string | undefined) ?? null;
}
async function setMarker(db: Deps["db"], key: string, value: string) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** One scheduler tick. Daily and weekly jobs run once per local day / Monday. */
export async function runScheduledJobs(deps: Deps, now = new Date()) {
  const { db } = deps;
  const result: Record<string, number | string> = {};
  const local = localTime(now);

  result.ended = await endMatchesPastPrd(deps, now);
  if (withinWakingHours(now)) result.touchpoints = await deliverDueTouchpoints(deps, now);
  result.unreadEmails = await sendUnreadEmails(deps, now);

  if ((await getMarker(db, "job:daily")) !== local.date) {
    await setMarker(db, "job:daily", local.date);
    result.purged = await purgeOldData(deps, now);
  }
  if (local.weekday === "Mon" && local.hour >= 8 && (await getMarker(db, "job:digest")) !== local.date) {
    await setMarker(db, "job:digest", local.date);
    result.digest = await sendDigest(deps, now);
  }
  return result;
}

const LOCK_ID = 7_310_501; // arbitrary, app-wide

/** Runs the jobs every 10 minutes. A Postgres advisory lock keeps overlapping deploys from double-running. */
export function startScheduler(deps: Deps, intervalMs = 10 * 60_000) {
  const tick = async () => {
    try {
      const [{ locked }] = await deps.db.execute<{ locked: boolean }>(sql`select pg_try_advisory_lock(${LOCK_ID}) as locked`);
      if (!locked) return;
      try {
        const result = await runScheduledJobs(deps);
        if (Object.values(result).some((v) => v !== 0)) console.log("[jobs]", JSON.stringify(result));
      } finally {
        await deps.db.execute(sql`select pg_advisory_unlock(${LOCK_ID})`);
      }
    } catch (err) {
      console.error("[jobs] tick failed", err);
    }
  };
  setTimeout(tick, 15_000);
  return setInterval(tick, intervalMs);
}
