import { and, asc, eq, ilike, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Deps } from "../app.js";
import { profiles, roster, users } from "../db/schema.js";
import {
  CAREER_GOALS,
  COMMISSIONING_SOURCES,
  GRADES,
  LEADERSHIP_INTERESTS,
  MENTORSHIP_ROLES,
  PERSONAL_FACTORS,
  SERVICES,
  UNITS,
} from "../domain/options.js";
import { type AppEnv, requireUser } from "../lib/session.js";

const pick = <T extends readonly string[]>(values: T) => z.enum(values as unknown as [string, ...string[]]);

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  service: z.enum(["usmc", "usn"]),
  grade: pick(GRADES),
  mosOrDesignator: z.string().trim().min(2).max(40),
  unit: pick(UNITS),
  section: z.string().trim().max(80).optional().nullable(),
  reportingSeniorRosterId: z.string().uuid().optional().nullable(),
  reviewingOfficerRosterId: z.string().uuid().optional().nullable(),
  prd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  commissioningSource: pick(COMMISSIONING_SOURCES).optional().nullable(),
  mentorshipRole: z.enum(["mentor", "mentee", "both"]),
  mentorCapacity: z.number().int().min(1).max(3).default(1),
  careerGoals: z.array(pick(CAREER_GOALS)).max(CAREER_GOALS.length).default([]),
  leadershipInterests: z.array(pick(LEADERSHIP_INTERESTS)).max(LEADERSHIP_INTERESTS.length).default([]),
  personalFactors: z.array(pick(PERSONAL_FACTORS)).max(PERSONAL_FACTORS.length).default([]),
  bio: z.string().trim().max(1000).optional().nullable(),
});

export function meRoutes({ db, config }: Deps) {
  const app = new Hono<AppEnv>();

  app.get("/options", (c) =>
    c.json({
      services: SERVICES,
      grades: GRADES,
      units: UNITS,
      commissioningSources: COMMISSIONING_SOURCES,
      careerGoals: CAREER_GOALS,
      leadershipInterests: LEADERSHIP_INTERESTS,
      personalFactors: PERSONAL_FACTORS,
      mentorshipRoles: MENTORSHIP_ROLES,
    }),
  );

  app.use("/me/*", requireUser(db, config));
  app.use("/me", requireUser(db, config));
  app.use("/roster/*", requireUser(db, config));

  app.get("/me", async (c) => {
    const user = c.get("user");
    const [rosterEntry] = await db
      .select({ name: roster.name, service: roster.service, grade: roster.grade, unit: roster.unit })
      .from(roster)
      .where(eq(roster.email, user.email));
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id));

    // Resolve RS/RO names for display.
    const ids = [profile?.reportingSeniorRosterId, profile?.reviewingOfficerRosterId].filter(Boolean) as string[];
    const people = ids.length
      ? await db.select({ id: roster.id, name: roster.name, grade: roster.grade }).from(roster).where(inArray(roster.id, ids))
      : [];

    return c.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        safetyAcknowledged: Boolean(user.safetyAcknowledgedAt),
      },
      roster: rosterEntry ?? null,
      profile: profile ?? null,
      people,
    });
  });

  app.post("/me/acknowledge-safety", async (c) => {
    await db.update(users).set({ safetyAcknowledgedAt: new Date() }).where(eq(users.id, c.get("user").id));
    return c.json({ status: "acknowledged" });
  });

  app.put("/me/profile", async (c) => {
    const user = c.get("user");
    if (!user.safetyAcknowledgedAt) return c.json({ error: "acknowledge the safety notice first" }, 409);
    const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "please fix the highlighted fields", fields: parsed.error.flatten().fieldErrors }, 400);
    }
    const data = parsed.data;
    if (data.mentorshipRole === "mentee") data.mentorCapacity = 1;
    if (data.prd <= new Date().toISOString().slice(0, 10)) {
      return c.json({ error: "please fix the highlighted fields", fields: { prd: ["must be in the future"] } }, 400);
    }

    // RS/RO must be real roster entries, and not the officer themself.
    const ids = [data.reportingSeniorRosterId, data.reviewingOfficerRosterId].filter(Boolean) as string[];
    if (ids.length) {
      const found = await db.select({ id: roster.id, email: roster.email }).from(roster).where(inArray(roster.id, ids));
      if (found.length !== new Set(ids).size || found.some((r) => r.email === user.email)) {
        return c.json({ error: "choose your RS and RO from the roster" }, 400);
      }
    }

    const row = { ...data, userId: user.id, updatedAt: new Date() };
    await db.insert(profiles).values(row).onConflictDoUpdate({ target: profiles.userId, set: row });
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, user.id));
    return c.json({ profile });
  });

  // Picker for reporting senior / reviewing officer. Names, grades and units
  // only — never roster emails.
  app.get("/roster/search", async (c) => {
    const q = (c.req.query("q") ?? "").trim();
    if (q.length < 2) return c.json({ results: [] });
    const results = await db
      .select({ id: roster.id, name: roster.name, grade: roster.grade, unit: roster.unit })
      .from(roster)
      .where(and(eq(roster.active, true), ilike(roster.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`)))
      .orderBy(asc(roster.name))
      .limit(10);
    return c.json({ results });
  });

  return app;
}
