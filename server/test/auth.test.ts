import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { loginCodes } from "../src/db/schema.js";
import { addRoster, db, makeClient, resetDb, sql } from "./helpers.js";

beforeEach(resetDb);
afterAll(() => sql.end());

describe("sign-in", () => {
  it("sends a code only to rostered officers, with an identical response either way", async () => {
    await addRoster([{ email: "lt.smith@example.com", name: "Smith, John" }]);
    const client = makeClient();
    const onRoster = await client.call("POST", "/auth/request-code", { email: "LT.Smith@example.com " });
    const offRoster = await client.call("POST", "/auth/request-code", { email: "stranger@example.com" });
    expect(onRoster).toEqual(offRoster);
    expect(client.mailer.sent.map((m) => m.to)).toEqual(["lt.smith@example.com"]);
  });

  it("signs in with the emailed code and rejects reuse", async () => {
    await addRoster([{ email: "lt.smith@example.com", name: "Smith, John" }]);
    const client = makeClient();
    expect((await client.signIn("lt.smith@example.com")).status).toBe(200);
    const me = await client.call("GET", "/me");
    expect(me.body.user).toMatchObject({ email: "lt.smith@example.com", role: "officer" });
    expect(me.body.roster).toMatchObject({ name: "Smith, John" });

    const code = client.mailer.sent[0].subject.slice(0, 6);
    const reuse = await makeClient().call("POST", "/auth/verify", { email: "lt.smith@example.com", code });
    expect(reuse.status).toBe(400);
  });

  it("locks a code after 5 wrong guesses", async () => {
    await addRoster([{ email: "lt.smith@example.com", name: "Smith, John" }]);
    const client = makeClient();
    await client.call("POST", "/auth/request-code", { email: "lt.smith@example.com" });
    const code = client.mailer.sent[0].subject.slice(0, 6);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await client.call("POST", "/auth/verify", { email: "lt.smith@example.com", code: wrong });
    const res = await client.call("POST", "/auth/verify", { email: "lt.smith@example.com", code });
    expect(res.status).toBe(400);
  });

  it("caps codes per address per window", async () => {
    await addRoster([{ email: "lt.smith@example.com", name: "Smith, John" }]);
    const client = makeClient();
    for (let i = 0; i < 5; i++) await client.call("POST", "/auth/request-code", { email: "lt.smith@example.com" });
    expect(client.mailer.sent).toHaveLength(3);
    expect(await db.select().from(loginCodes)).toHaveLength(3);
  });

  it("lets configured admins in without a roster entry", async () => {
    const client = makeClient();
    await client.signIn("admin@example.com");
    expect((await client.call("GET", "/me")).body.user.role).toBe("admin");
  });

  it("blocks officers deactivated after the code was sent", async () => {
    const [entry] = await addRoster([{ email: "lt.smith@example.com", name: "Smith, John" }]);
    const client = makeClient();
    await client.call("POST", "/auth/request-code", { email: "lt.smith@example.com" });
    await sql`update roster set active = false where id = ${entry.id}`;
    const code = client.mailer.sent[0].subject.slice(0, 6);
    expect((await client.call("POST", "/auth/verify", { email: "lt.smith@example.com", code })).status).toBe(400);
  });

  it("rejects requests without a session", async () => {
    expect((await makeClient().call("GET", "/me")).status).toBe(401);
  });
});
