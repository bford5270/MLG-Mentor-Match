import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addRoster, makeClient, resetDb, sql } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => sql.end());

const future = new Date(Date.now() + 400 * 86400_000).toISOString().slice(0, 10);
const baseProfile = {
  name: "Smith, John",
  service: "usmc",
  grade: "O-2",
  mosOrDesignator: "0402",
  unit: "CLR-1",
  prd: future,
  mentorshipRole: "mentee",
  careerGoals: ["Command"],
};

async function signedInOfficer() {
  const people = await addRoster([
    { email: "lt.smith@example.com", name: "Smith, John", grade: "O-2" },
    { email: "capt.jones@example.com", name: "Jones, Amy", grade: "O-3" },
    { email: "maj.lee@example.com", name: "Lee, Sam", grade: "O-4" },
  ]);
  const client = makeClient();
  await client.signIn("lt.smith@example.com");
  return { client, people };
}

describe("profile", () => {
  it("requires the safety acknowledgment first", async () => {
    const { client } = await signedInOfficer();
    expect((await client.call("PUT", "/me/profile", baseProfile)).status).toBe(409);
    await client.call("POST", "/me/acknowledge-safety", {});
    expect((await client.call("PUT", "/me/profile", baseProfile)).status).toBe(200);
  });

  it("saves and updates the profile with RS/RO from the roster", async () => {
    const { client, people } = await signedInOfficer();
    await client.call("POST", "/me/acknowledge-safety", {});
    const res = await client.call("PUT", "/me/profile", {
      ...baseProfile,
      reportingSeniorRosterId: people[1].id,
      reviewingOfficerRosterId: people[2].id,
    });
    expect(res.status).toBe(200);
    await client.call("PUT", "/me/profile", { ...baseProfile, grade: "O-3", mentorshipRole: "both", mentorCapacity: 2 });
    const me = await client.call("GET", "/me");
    expect(me.body.profile).toMatchObject({ grade: "O-3", mentorshipRole: "both", mentorCapacity: 2 });
  });

  it("rejects invalid fields, past PRDs, and self as RS", async () => {
    const { client, people } = await signedInOfficer();
    await client.call("POST", "/me/acknowledge-safety", {});
    expect((await client.call("PUT", "/me/profile", { ...baseProfile, grade: "E-5" })).body.fields.grade).toBeTruthy();
    expect((await client.call("PUT", "/me/profile", { ...baseProfile, prd: "2020-01-01" })).body.fields.prd).toBeTruthy();
    const self = await client.call("PUT", "/me/profile", { ...baseProfile, reportingSeniorRosterId: people[0].id });
    expect(self.status).toBe(400);
  });

  it("roster search returns names but never emails", async () => {
    const { client } = await signedInOfficer();
    const res = await client.call("GET", "/roster/search?q=jon");
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toEqual({ id: expect.any(String), name: "Jones, Amy", grade: "O-3", unit: null });
  });
});
