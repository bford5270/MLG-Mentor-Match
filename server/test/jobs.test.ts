import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildDigest,
  deliverDueTouchpoints,
  endMatchesPastPrd,
  localTime,
  purgeOldData,
  runScheduledJobs,
  sendUnreadEmails,
} from "../src/domain/jobs.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { addRoster, config, db, hub, makeClient, pusher, resetDb, sql } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => sql.end());

const future = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);
const deps = (mailer = new MemoryMailer()) => ({ db, config, hub, pusher, mailer });

async function officer(email: string, profile: Record<string, unknown>) {
  const client = makeClient();
  await client.signIn(email);
  await client.call("POST", "/me/acknowledge-safety", {});
  await client.call("PUT", "/me/profile", { name: email, service: "usmc", mosOrDesignator: "0402", unit: "CLR-1", prd: future, ...profile });
  return client;
}

async function approvedMatch() {
  await addRoster([
    { email: "maj@example.com", name: "Maj", grade: "O-4" },
    { email: "lt@example.com", name: "Lt", grade: "O-2" },
  ]);
  const mentor = await officer("maj@example.com", { grade: "O-4", mentorshipRole: "mentor" });
  const mentee = await officer("lt@example.com", { grade: "O-2", mentorshipRole: "mentee" });
  // Each officer registers a device for push.
  await mentor.call("POST", "/push/subscribe", { endpoint: "https://push.example/maj", keys: { p256dh: "p256dh-maj-key", auth: "auth-maj" } });
  await mentee.call("POST", "/push/subscribe", { endpoint: "https://push.example/lt", keys: { p256dh: "p256dh-lt-key", auth: "auth-lt" } });
  const admin = makeClient();
  await admin.signIn("admin@example.com");
  await admin.call("POST", "/matching/run", {});
  const [pending] = (await admin.call("GET", "/matching/overview")).body.queue;
  await admin.call("POST", `/matching/matches/${pending.id}/approve`, {});
  return { mentor, mentee, admin, matchId: pending.id as string };
}

describe("touch points", () => {
  it("posts the kickoff on approval and pushes both officers", async () => {
    const { mentee, matchId } = await approvedMatch();
    const thread = (await mentee.call("GET", `/chat/${matchId}/messages`)).body;
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ senderId: null, touchpointId: "week-0-kickoff" });
    expect(thread.messages[0].body).toMatch(/Kickoff/);
    const endpoints = pusher.sent.map((p) => p.endpoint).sort();
    expect(endpoints).toEqual(expect.arrayContaining(["https://push.example/lt", "https://push.example/maj"]));
    // Lock-screen text never includes chat content.
    expect(pusher.sent.every((p) => !p.payload.body.includes("To talk about"))).toBe(true);
  });

  it("delivers later touch points when due, once each", async () => {
    const { mentee, matchId } = await approvedMatch();
    const in31days = new Date(Date.now() + 31 * 86400_000);
    expect(await deliverDueTouchpoints(deps(), in31days)).toBe(2); // week 2 + month 1
    expect(await deliverDueTouchpoints(deps(), in31days)).toBe(0);
    const ids = (await mentee.call("GET", `/chat/${matchId}/messages`)).body.messages.map((m: any) => m.touchpointId);
    expect(ids).toEqual(["week-0-kickoff", "week-2-philosophy", "month-1-evaluations"]);
  });

  it("can be marked discussed, and the G-10 sees counts only", async () => {
    const { mentee, admin, matchId } = await approvedMatch();
    expect((await mentee.call("POST", `/chat/${matchId}/touchpoints/week-0-kickoff/discussed`, {})).status).toBe(200);
    const program = (await admin.call("GET", "/matching/program")).body;
    expect(program.touchpoints.find((t: any) => t.id === "week-0-kickoff")).toMatchObject({ delivered: 1, discussed: 1 });
  });

  it("skips inactive touch points and lets the G-10 edit them", async () => {
    const { admin, mentee, matchId } = await approvedMatch();
    const res = await admin.call("PUT", "/matching/touchpoints/week-2-philosophy", {
      title: "Leadership philosophy (edited)", body: "Updated guidance for this touch point.", questions: ["What drives you?"], active: false,
    });
    expect(res.status).toBe(200);
    await deliverDueTouchpoints(deps(), new Date(Date.now() + 15 * 86400_000));
    const ids = (await mentee.call("GET", `/chat/${matchId}/messages`)).body.messages.map((m: any) => m.touchpointId);
    expect(ids).toEqual(["week-0-kickoff"]);
    expect((await mentee.call("PUT", "/matching/touchpoints/week-2-philosophy", { title: "x" })).status).toBe(403);
  });

  it("sends the transition prompt 60 days before the end date", async () => {
    const { mentee, matchId } = await approvedMatch();
    const ends = (await sql`select ends_on from matches where id = ${matchId}`)[0].ends_on as string;
    const day = new Date(new Date(`${ends}T12:00:00Z`).getTime() - 59 * 86400_000);
    await deliverDueTouchpoints(deps(), day);
    const ids = (await mentee.call("GET", `/chat/${matchId}/messages`)).body.messages.map((m: any) => m.touchpointId);
    expect(ids).toContain("prd-transition");
  });
});

describe("lifecycle jobs", () => {
  it("ends matches after the earlier PRD and asks for feedback", async () => {
    const { mentee, admin, matchId } = await approvedMatch();
    await sql`update matches set ends_on = current_date - 1 where id = ${matchId}`;
    expect(await endMatchesPastPrd(deps(), new Date())).toBe(1);
    expect((await mentee.call("GET", "/me/matches")).body.matches).toHaveLength(0);
    const due = (await mentee.call("GET", "/me/feedback-due")).body.due;
    expect(due).toEqual([expect.objectContaining({ matchId, myRole: "mentee" })]);
    expect((await mentee.call("POST", `/me/matches/${matchId}/feedback`, { rating: 5, wouldRecommend: true, comment: "Great mentor." })).status).toBe(200);
    expect((await mentee.call("GET", "/me/feedback-due")).body.due).toHaveLength(0);
    const program = (await admin.call("GET", "/matching/program")).body;
    expect(program.feedback).toMatchObject({ count: 1, averageRating: 5, recommendPercent: 100 });
  });

  it("emails unread messages after 2 hours, at most daily, without content", async () => {
    const { mentor, matchId } = await approvedMatch();
    await mentor.call("POST", `/chat/${matchId}/messages`, { body: "private words" });
    const mailer = new MemoryMailer();
    const later = new Date(Date.now() + 3 * 3600_000);
    // Only the mentee: sending a message also marks the mentor's own thread read.
    expect(await sendUnreadEmails(deps(mailer), later)).toBe(1);
    expect(mailer.sent[0].to).toBe("lt@example.com");
    expect(mailer.sent.every((m) => !m.text.includes("private words"))).toBe(true);
    expect(await sendUnreadEmails(deps(mailer), new Date(later.getTime() + 3600_000))).toBe(0);
    expect(await sendUnreadEmails(deps(new MemoryMailer()), new Date())).toBe(0);
  });

  it("purges chat 30 days after a match closes", async () => {
    const { mentor, matchId } = await approvedMatch();
    await mentor.call("POST", `/chat/${matchId}/end`, {});
    expect(await purgeOldData({ db }, new Date(Date.now() + 10 * 86400_000))).toBe(0);
    expect(await purgeOldData({ db }, new Date(Date.now() + 31 * 86400_000))).toBeGreaterThan(0);
    expect((await sql`select count(*)::int as n from messages`)[0].n).toBe(0);
  });

  it("builds a digest and sends it on Monday morning only once", async () => {
    await approvedMatch();
    const { stats, text } = await buildDigest({ db }, new Date());
    expect(stats.active).toBe(1);
    expect(text).toMatch(/Active matches: 1/);
    // Find the next Monday 09:00 Pacific.
    let t = new Date();
    while (!(localTime(t).weekday === "Mon" && localTime(t).hour === 9)) t = new Date(t.getTime() + 3600_000);
    const mailer = new MemoryMailer();
    const first = await runScheduledJobs(deps(mailer), t);
    expect(first.digest).toBe(1); // the admin
    const second = await runScheduledJobs(deps(mailer), new Date(t.getTime() + 600_000));
    expect(second.digest).toBeUndefined();
  });
});

describe("push subscriptions", () => {
  it("drops subscriptions the push service reports gone", async () => {
    const { mentor, matchId } = await approvedMatch();
    pusher.gone.add("https://push.example/lt");
    await mentor.call("POST", `/chat/${matchId}/messages`, { body: "hello" });
    await new Promise((r) => setTimeout(r, 100));
    expect((await sql`select endpoint from push_subscriptions`).map((r) => r.endpoint)).toEqual(["https://push.example/maj"]);
    pusher.gone.clear();
  });
});
