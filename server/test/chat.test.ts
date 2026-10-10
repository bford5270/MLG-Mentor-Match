import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addRoster, hub, makeClient, resetDb, sql } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => sql.end());

const future = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);
const SECRET = "Let's talk about my FITREP on Tuesday";

async function officer(email: string, profile: Record<string, unknown>) {
  const client = makeClient();
  await client.signIn(email);
  await client.call("POST", "/me/acknowledge-safety", {});
  await client.call("PUT", "/me/profile", {
    name: email, service: "usmc", mosOrDesignator: "0402", unit: "CLR-1", prd: future, ...profile,
  });
  return client;
}

/** A mentor and mentee with an approved match, plus an outsider and a G-10. */
async function activeMatch() {
  await addRoster([
    { email: "maj@example.com", name: "Maj", grade: "O-4" },
    { email: "lt@example.com", name: "Lt", grade: "O-2" },
    { email: "capt@example.com", name: "Capt", grade: "O-3" },
  ]);
  const mentor = await officer("maj@example.com", { grade: "O-4", mentorshipRole: "mentor" });
  const mentee = await officer("lt@example.com", { grade: "O-2", mentorshipRole: "mentee" });
  const outsider = await officer("capt@example.com", { grade: "O-3", mentorshipRole: "mentee", unit: "CLR-17" });
  const admin = makeClient();
  await admin.signIn("admin@example.com");
  // Only the Lt can match (the Capt needs an O-4+ in another chain — the Maj — but the Maj has capacity 1).
  await admin.call("POST", "/matching/run", {});
  const queue = (await admin.call("GET", "/matching/overview")).body.queue;
  const ours = queue.find((q: any) => q.mentee.name === "lt@example.com") ?? queue[0];
  if (ours.mentee.name !== "lt@example.com") {
    await admin.call("POST", `/matching/matches/${ours.id}/reassign`, { newMenteeId: (await mentee.call("GET", "/me")).body.user.id });
  }
  const pending = (await admin.call("GET", "/matching/overview")).body.queue.find((q: any) => q.mentee.name === "lt@example.com");
  await admin.call("POST", `/matching/matches/${pending.id}/approve`, {});
  const matchId = (await mentee.call("GET", "/me/matches")).body.matches[0].id as string;
  return { mentor, mentee, outsider, admin, matchId };
}

describe("chat", () => {
  it("delivers messages between the pair, with unread counts and live events", async () => {
    const { mentor, mentee, matchId } = await activeMatch();
    const menteeId = (await mentee.call("GET", "/me")).body.user.id;
    const received: string[] = [];
    const socket = { send: (d: string) => received.push(d) };
    hub.add(menteeId, socket);

    const sent = await mentor.call("POST", `/chat/${matchId}/messages`, { body: SECRET });
    expect(sent.status).toBe(200);
    expect(JSON.parse(received[0])).toMatchObject({ type: "message", matchId, message: { body: SECRET } });
    hub.remove(menteeId, socket);

    // The kickoff touch point (system message) plus the mentor's message.
    expect((await mentee.call("GET", "/me/matches")).body.matches[0].unread).toBe(2);
    const thread = await mentee.call("GET", `/chat/${matchId}/messages`);
    expect(thread.body.messages.map((m: any) => m.body).slice(1)).toEqual([SECRET]);
    await mentee.call("POST", `/chat/${matchId}/read`, {});
    expect((await mentee.call("GET", "/me/matches")).body.matches[0].unread).toBe(0);
    expect((await mentor.call("GET", "/me/matches")).body.matches[0].unread).toBe(0);
  });

  it("keeps the conversation away from everyone else, including admins and approvers", async () => {
    const { mentor, outsider, admin, matchId } = await activeMatch();
    await mentor.call("POST", `/chat/${matchId}/messages`, { body: SECRET });

    for (const client of [outsider, admin]) {
      expect((await client.call("GET", `/chat/${matchId}/messages`)).status).toBe(404);
      expect((await client.call("POST", `/chat/${matchId}/messages`, { body: "hi" })).status).toBe(404);
      expect((await client.call("POST", `/chat/${matchId}/report`, { description: "trying to see content" })).status).toBe(404);
    }
    // No admin/approver view returns message content.
    const adminViews = await Promise.all([
      admin.call("GET", "/matching/overview"),
      admin.call("GET", "/matching/reports"),
      admin.call("GET", "/admin/users"),
      admin.call("GET", "/admin/roster"),
    ]);
    for (const view of adminViews) expect(JSON.stringify(view.body)).not.toContain(SECRET);
    expect((await makeClient().call("GET", `/chat/${matchId}/messages`)).status).toBe(401);
  });

  it("validates and rate-limits sends", async () => {
    const { mentor, matchId } = await activeMatch();
    expect((await mentor.call("POST", `/chat/${matchId}/messages`, { body: "   " })).status).toBe(400);
    expect((await mentor.call("POST", `/chat/${matchId}/messages`, { body: "x".repeat(2001) })).status).toBe(400);
    const statuses = [];
    for (let i = 0; i < 31; i++) statuses.push((await mentor.call("POST", `/chat/${matchId}/messages`, { body: `m${i}` })).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });

  it("paginates older messages", async () => {
    const { mentor, mentee, matchId } = await activeMatch();
    await sql`insert into messages (match_id, sender_id, body, created_at)
      select ${matchId}, (select id from users where email = 'maj@example.com'), 'msg ' || g, now() - (g || ' minutes')::interval
      from generate_series(1, 60) g`;
    const first = (await mentee.call("GET", `/chat/${matchId}/messages`)).body;
    expect(first.messages).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    const older = (await mentee.call("GET", `/chat/${matchId}/messages?before=${encodeURIComponent(first.messages[0].createdAt)}`)).body;
    expect(older.messages).toHaveLength(11); // 10 seeded + the kickoff touch point
    expect(older.hasMore).toBe(false);
    void mentor;
  });

  it("reports share only what the reporter chooses", async () => {
    const { mentor, mentee, admin, matchId } = await activeMatch();
    const a = (await mentor.call("POST", `/chat/${matchId}/messages`, { body: "first message" })).body.message;
    await mentor.call("POST", `/chat/${matchId}/messages`, { body: SECRET });
    const res = await mentee.call("POST", `/chat/${matchId}/report`, {
      description: "My mentor said something inappropriate.",
      attachMessageIds: [a.id],
    });
    expect(res.status).toBe(200);
    const [report] = (await admin.call("GET", "/matching/reports")).body.reports;
    expect(report.description).toMatch(/inappropriate/);
    expect(report.attachedMessages).toEqual([expect.objectContaining({ body: "first message", from: "other officer" })]);
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect((await admin.call("POST", `/matching/reports/${report.id}/resolve`, {})).status).toBe(200);
  });

  it("either officer can end the match; it closes chat and is never re-proposed", async () => {
    const { mentor, mentee, admin, matchId } = await activeMatch();
    expect((await mentee.call("POST", `/chat/${matchId}/end`, { reason: "not a fit" })).status).toBe(200);
    expect((await mentor.call("POST", `/chat/${matchId}/messages`, { body: "hello?" })).status).toBe(409);
    expect((await mentor.call("GET", "/me/matches")).body.matches).toHaveLength(0);
    await admin.call("POST", "/matching/run", {});
    const queue = (await admin.call("GET", "/matching/overview")).body.queue;
    expect(queue.some((q: any) => q.mentor.name === "maj@example.com" && q.mentee.name === "lt@example.com")).toBe(false);
  });

  it("the approver can end an active match", async () => {
    const { mentee, admin, matchId } = await activeMatch();
    expect((await admin.call("POST", `/matching/matches/${matchId}/end`, { note: "after report" })).status).toBe(200);
    expect((await mentee.call("POST", `/chat/${matchId}/messages`, { body: "hi" })).status).toBe(409);
  });
});
