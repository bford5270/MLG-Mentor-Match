import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { addRoster, makeClient, resetDb, sql } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => sql.end());

const csv = `Email,Name,Service,Grade,Unit
lt.smith@example.com,"Smith, John",USMC,O2,CLR-1
hm.doe@example.com,"Doe, Jane",Navy,O-3,1st Medical Battalion
bad-email,"Nobody",USMC,O-1,
x@example.com,"Enlisted, Pat",USMC,E-5,
`;

describe("admin roster", () => {
  it("imports valid rows and reports bad ones", async () => {
    const admin = makeClient();
    await admin.signIn("admin@example.com");
    const res = await admin.call("POST", "/admin/roster", { csv });
    expect(res.body.imported).toBe(2);
    expect(res.body.errors.map((e: any) => e.line)).toEqual([4, 5]);
    const roster = (await admin.call("GET", "/admin/roster")).body.roster;
    expect(roster.find((r: any) => r.email === "hm.doe@example.com")).toMatchObject({ service: "usn", grade: "O-3" });
    expect(roster.find((r: any) => r.email === "lt.smith@example.com")).toMatchObject({ grade: "O-2" });
  });

  it("can deactivate officers missing from a new upload", async () => {
    await addRoster([{ email: "gone@example.com", name: "Gone, Al" }]);
    const admin = makeClient();
    await admin.signIn("admin@example.com");
    const res = await admin.call("POST", "/admin/roster", { csv, deactivateMissing: true });
    expect(res.body.deactivated).toBe(1);
  });

  it("is admin-only", async () => {
    await addRoster([{ email: "lt.smith@example.com", name: "Smith, John" }]);
    const officer = makeClient();
    await officer.signIn("lt.smith@example.com");
    expect((await officer.call("GET", "/admin/roster")).status).toBe(403);
    expect((await officer.call("POST", "/admin/roster", { csv })).status).toBe(403);
  });

  it("assigns the approver role and prevents self-demotion", async () => {
    await addRoster([{ email: "g10@example.com", name: "Approver, G" }]);
    const g10 = makeClient();
    await g10.signIn("g10@example.com");
    const admin = makeClient();
    await admin.signIn("admin@example.com");
    const users = (await admin.call("GET", "/admin/users")).body.users;
    const target = users.find((u: any) => u.email === "g10@example.com");
    expect((await admin.call("POST", `/admin/users/${target.id}/role`, { role: "approver" })).status).toBe(200);
    expect((await g10.call("GET", "/me")).body.user.role).toBe("approver");

    const self = users.find((u: any) => u.email === "admin@example.com");
    expect((await admin.call("POST", `/admin/users/${self.id}/role`, { role: "officer" })).status).toBe(400);
  });

  it("rejects non-JSON writes", async () => {
    const { createApi } = await import("../src/app.js");
    const { db, config } = await import("./helpers.js");
    const { MemoryMailer } = await import("../src/lib/mailer.js");
    const { Hub } = await import("../src/lib/hub.js");
    const { MemoryPusher } = await import("../src/lib/push.js");
    const api = createApi({ db, config, mailer: new MemoryMailer(), hub: new Hub(), pusher: new MemoryPusher() });
    const res = await api.request("/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=admin@example.com",
    });
    expect(res.status).toBe(415);
  });
});
