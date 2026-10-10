import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { createApi } from "../src/app.js";
import { seedTouchpoints } from "../src/domain/jobs.js";
import type { Config } from "../src/config.js";
import * as schema from "../src/db/schema.js";
import { Hub } from "../src/lib/hub.js";
import { MemoryMailer } from "../src/lib/mailer.js";
import { MemoryPusher } from "../src/lib/push.js";

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error("TEST_DATABASE_URL is not set (point it at a disposable database)");

export const sql = postgres(url, { max: 2, onnotice: () => {} });
export const db = drizzle(sql, { schema });

export async function resetDb() {
  await sql`drop schema if exists public cascade`;
  await sql`drop schema if exists drizzle cascade`;
  await sql`create schema public`;
  await migrate(db, { migrationsFolder: "./drizzle" });
  await seedTouchpoints({ db });
  pusher.sent = [];
}

export const config: Config = {
  sessionSecret: "test-secret",
  production: false,
  adminEmails: ["admin@example.com"],
  emailFrom: "test@example.com",
  siteUrl: "https://example.test",
};

/** One hub for every client, like the real server. */
export const hub = new Hub();
export const pusher = new MemoryPusher();

export function makeClient() {
  const mailer = new MemoryMailer();
  const api = createApi({ db, mailer, config, hub, pusher });
  let cookie = "";
  async function call(method: string, path: string, body?: unknown) {
    const res = await api.request(path, {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, body: (await res.json()) as any };
  }
  async function signIn(email: string) {
    await call("POST", "/auth/request-code", { email });
    const code = mailer.sent.at(-1)?.subject.slice(0, 6);
    if (!code) throw new Error(`no code sent to ${email}`);
    return call("POST", "/auth/verify", { email, code });
  }
  return { call, signIn, mailer };
}

export async function addRoster(rows: { email: string; name: string; service?: "usmc" | "usn"; grade?: string }[]) {
  return db
    .insert(schema.roster)
    .values(rows.map((r) => ({ service: "usmc" as const, grade: "O-3", ...r })))
    .returning();
}
