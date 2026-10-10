import { asc, eq, notInArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { auditEvents, profiles, roster, users } from "../db/schema.js";
import { GRADES } from "../domain/options.js";
import { normalizeEmail } from "../lib/codes.js";
import { parseCsv } from "../lib/csv.js";
import { type AppEnv, requireRole, requireUser } from "../lib/session.js";

const SERVICE_ALIASES: Record<string, "usmc" | "usn"> = {
  usmc: "usmc",
  marine: "usmc",
  "marine corps": "usmc",
  usn: "usn",
  navy: "usn",
};

const uploadSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  /** Mark officers absent from this upload inactive (they can no longer sign in). */
  deactivateMissing: z.boolean().default(false),
});

const roleSchema = z.object({ role: z.enum(["officer", "approver", "admin"]) });

export function adminRoutes({ db, config }: Deps) {
  const app = new Hono<AppEnv>();
  app.use("*", requireUser(db, config), requireRole("admin"));

  app.get("/roster", async (c) => {
    const rows = await db.select().from(roster).orderBy(asc(roster.name));
    return c.json({ roster: rows });
  });

  // CSV columns (header row required, any order): email, name, service, grade, unit
  app.post("/roster", async (c) => {
    const parsed = uploadSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "paste or upload a CSV file" }, 400);

    const [header, ...lines] = parseCsv(parsed.data.csv);
    const cols = (header ?? []).map((h) => h.trim().toLowerCase());
    const idx = (name: string) => cols.indexOf(name);
    const missing = ["email", "name", "service", "grade"].filter((n) => idx(n) === -1);
    if (missing.length) return c.json({ error: `CSV is missing column(s): ${missing.join(", ")}` }, 400);

    const errors: { line: number; message: string }[] = [];
    const valid: (typeof roster.$inferInsert)[] = [];
    const seen = new Set<string>();
    lines.forEach((cells, i) => {
      const line = i + 2;
      const get = (n: string) => (idx(n) === -1 ? "" : (cells[idx(n)] ?? "").trim());
      const email = normalizeEmail(get("email"));
      const service = SERVICE_ALIASES[get("service").toLowerCase()];
      const grade = get("grade").toUpperCase().replace(/^([OW])(\d)$/, "$1-$2");
      if (!z.string().email().safeParse(email).success) return errors.push({ line, message: "invalid email" });
      if (seen.has(email)) return errors.push({ line, message: "duplicate email in file" });
      if (!get("name")) return errors.push({ line, message: "missing name" });
      if (!service) return errors.push({ line, message: "service must be USMC or USN" });
      if (!(GRADES as readonly string[]).includes(grade)) return errors.push({ line, message: `unknown grade "${get("grade")}"` });
      seen.add(email);
      valid.push({ email, name: get("name"), service, grade, unit: get("unit") || null, active: true });
    });

    let deactivated = 0;
    await db.transaction(async (tx) => {
      for (const row of valid) {
        await tx
          .insert(roster)
          .values(row)
          .onConflictDoUpdate({
            target: roster.email,
            set: { name: row.name, service: row.service, grade: row.grade, unit: row.unit, active: true },
          });
      }
      if (parsed.data.deactivateMissing && valid.length) {
        const res = await tx
          .update(roster)
          .set({ active: false })
          .where(notInArray(roster.email, [...seen]))
          .returning({ id: roster.id });
        deactivated = res.length;
      }
      await tx.insert(auditEvents).values({
        actorId: c.get("user").id,
        action: "roster_upload",
        data: { imported: valid.length, errors: errors.length, deactivated },
      });
    });

    return c.json({ imported: valid.length, deactivated, errors });
  });

  app.get("/users", async (c) => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        name: profiles.name,
        grade: profiles.grade,
        unit: profiles.unit,
        mentorshipRole: profiles.mentorshipRole,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .orderBy(asc(users.email));
    return c.json({ users: rows.map((u) => ({ ...u, profileComplete: u.name !== null })) });
  });

  app.post("/users/:id/role", async (c) => {
    const parsed = roleSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid role" }, 400);
    const actor = c.get("user");
    const targetId = c.req.param("id");
    if (targetId === actor.id && parsed.data.role !== "admin") {
      return c.json({ error: "you can't remove your own admin role" }, 400);
    }
    const [updated] = await db
      .update(users)
      .set({ role: parsed.data.role })
      .where(eq(users.id, targetId))
      .returning({ id: users.id, role: users.role });
    if (!updated) return c.json({ error: "user not found" }, 404);
    await db.insert(auditEvents).values({
      actorId: actor.id,
      action: "role_change",
      data: { userId: targetId, role: parsed.data.role },
    });
    return c.json({ user: updated });
  });

  return app;
}
