import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addRoster, makeClient, resetDb, sql } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => sql.end());

const future = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);

async function officer(email: string, profile: Record<string, unknown>) {
  const client = makeClient();
  await client.signIn(email);
  await client.call("POST", "/me/acknowledge-safety", {});
  const res = await client.call("PUT", "/me/profile", {
    name: email,
    service: "usmc",
    mosOrDesignator: "0402",
    unit: "CLR-1",
    prd: future,
    careerGoals: ["Command"],
    ...profile,
  });
  if (res.status !== 200) throw new Error(JSON.stringify(res.body));
  return client;
}

async function setup() {
  await addRoster([
    { email: "maj@example.com", name: "Maj", grade: "O-4" },
    { email: "lt@example.com", name: "Lt", grade: "O-2" },
    { email: "ltcol@example.com", name: "LtCol", grade: "O-5" },
    { email: "g10@example.com", name: "G10", grade: "O-5" },
  ]);
  const maj = await officer("maj@example.com", { grade: "O-4", mentorshipRole: "mentor" });
  const lt = await officer("lt@example.com", { grade: "O-2", mentorshipRole: "mentee" });
  const ltcol = await officer("ltcol@example.com", { grade: "O-5", mentorshipRole: "mentor", unit: "CLR-15" });
  const g10 = makeClient();
  await g10.signIn("g10@example.com");
  const admin = makeClient();
  await admin.signIn("admin@example.com");
  const users = (await admin.call("GET", "/admin/users")).body.users;
  const id = (email: string) => users.find((u: any) => u.email === email).id;
  await admin.call("POST", `/admin/users/${id("g10@example.com")}/role`, { role: "approver" });
  return { maj, lt, ltcol, g10, id };
}

describe("approval queue", () => {
  it("proposes, hides pending from officers, and reveals on approval", async () => {
    const { lt, g10, maj } = await setup();
    const run = await g10.call("POST", "/matching/run", {});
    expect(run.body.proposed).toBe(1);

    const overview = (await g10.call("GET", "/matching/overview")).body;
    expect(overview.queue).toHaveLength(1);
    const [pending] = overview.queue;
    expect(pending.mentee.name).toBe("lt@example.com");
    expect(pending.alternates.mentor).toHaveLength(1); // the other mentor

    expect((await lt.call("GET", "/me/matches")).body.matches).toHaveLength(0);
    expect((await g10.call("POST", `/matching/matches/${pending.id}/approve`, {})).status).toBe(200);

    const mine = (await lt.call("GET", "/me/matches")).body.matches;
    expect(mine).toHaveLength(1);
    expect(mine[0].myRole).toBe("mentee");
    expect(mine[0].partner.name).toBe(pending.mentor.name);
    expect(mine[0].partner).not.toHaveProperty("email");
    expect((await maj.call("GET", "/me/matches")).body.matches).toHaveLength(pending.mentor.name === "maj@example.com" ? 1 : 0);
  });

  it("rejected pairs are not re-proposed", async () => {
    const { g10 } = await setup();
    await g10.call("POST", "/matching/run", {});
    let [first] = (await g10.call("GET", "/matching/overview")).body.queue;
    await g10.call("POST", `/matching/matches/${first.id}/reject`, { note: "test" });
    await g10.call("POST", "/matching/run", {});
    const [second] = (await g10.call("GET", "/matching/overview")).body.queue;
    expect(second.mentor.userId).not.toBe(first.mentor.userId);
    await g10.call("POST", `/matching/matches/${second.id}/reject`, {});
    expect((await g10.call("POST", "/matching/run", {})).body.proposed).toBe(0);
  });

  it("reassigns to an alternate, and guards active matches", async () => {
    const { g10 } = await setup();
    await g10.call("POST", "/matching/run", {});
    const [pending] = (await g10.call("GET", "/matching/overview")).body.queue;
    const alt = pending.alternates.mentor[0];
    const res = await g10.call("POST", `/matching/matches/${pending.id}/reassign`, { newMentorId: alt.userId });
    expect(res.status).toBe(200);
    const [now] = (await g10.call("GET", "/matching/overview")).body.queue;
    expect(now.mentor.userId).toBe(alt.userId);

    await g10.call("POST", `/matching/matches/${now.id}/approve`, {});
    const guarded = await g10.call("POST", `/matching/matches/${now.id}/reassign`, { newMentorId: pending.mentor.userId });
    expect(guarded.body.requiresConfirmation).toBe(true);
    const forced = await g10.call("POST", `/matching/matches/${now.id}/reassign`, { newMentorId: pending.mentor.userId, closeActive: true });
    expect(forced.status).toBe(200);
  });

  it("manual match enforces the hard rules", async () => {
    const { g10, id } = await setup();
    const bad = await g10.call("POST", "/matching/manual", { mentorId: id("lt@example.com"), menteeId: id("maj@example.com") });
    expect(bad.status).toBe(409);
    const ok = await g10.call("POST", "/matching/manual", { mentorId: id("maj@example.com"), menteeId: id("lt@example.com") });
    expect(ok.status).toBe(200);
    const dup = await g10.call("POST", "/matching/manual", { mentorId: id("ltcol@example.com"), menteeId: id("lt@example.com") });
    expect(dup.body.error).toBe("mentee already has a mentor");
  });

  it("expires pending matches after 14 days", async () => {
    const { g10 } = await setup();
    await g10.call("POST", "/matching/run", {});
    await sql`update matches set created_at = now() - interval '15 days'`;
    const overview = (await g10.call("GET", "/matching/overview")).body;
    expect(overview.queue).toHaveLength(0);
    expect(overview.unmatchedMentees).toHaveLength(1);
  });

  it("is limited to approvers and admins", async () => {
    const { lt } = await setup();
    expect((await lt.call("GET", "/matching/overview")).status).toBe(403);
    expect((await lt.call("POST", "/matching/run", {})).status).toBe(403);
  });
});
