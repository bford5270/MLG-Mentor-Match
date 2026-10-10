// Database reads/writes the matching routes share.
import { and, eq, inArray, lt, or } from "drizzle-orm";
import type { Db } from "../app.js";
import { auditEvents, matches, profiles, roster, users } from "../db/schema.js";
import { type Candidate, type PairContext, PENDING_EXPIRY_DAYS, pairKey } from "./matching.js";

export const OPEN_STATUSES = ["pending_approval", "active"] as const;

/** Every officer with a finished profile who is still allowed to sign in. */
export async function loadCandidates(db: Db): Promise<Candidate[]> {
  const rows = await db
    .select({ user: users, profile: profiles, rosterId: roster.id, rosterActive: roster.active })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .leftJoin(roster, eq(roster.email, users.email));
  return rows
    .filter((r) => r.rosterActive !== false)
    .map(({ user, profile, rosterId }) => ({
      userId: user.id,
      rosterId,
      name: profile.name,
      service: profile.service,
      grade: profile.grade,
      mosOrDesignator: profile.mosOrDesignator,
      unit: profile.unit,
      section: profile.section,
      reportingSeniorRosterId: profile.reportingSeniorRosterId,
      reviewingOfficerRosterId: profile.reviewingOfficerRosterId,
      prd: profile.prd,
      commissioningSource: profile.commissioningSource,
      mentorshipRole: profile.mentorshipRole,
      mentorCapacity: profile.mentorCapacity,
      careerGoals: profile.careerGoals,
      leadershipInterests: profile.leadershipInterests,
      personalFactors: profile.personalFactors,
    }));
}

export async function loadMatchState(db: Db) {
  const open = await db.select().from(matches).where(inArray(matches.status, [...OPEN_STATUSES]));
  // Rejected proposals and matches an officer ended are never proposed again.
  const rejected = await db
    .select({ mentorId: matches.mentorId, menteeId: matches.menteeId })
    .from(matches)
    .where(inArray(matches.status, ["rejected", "ended"]));

  const mentorLoad = new Map<string, number>();
  const matchedMentees = new Set<string>();
  const openPairs = new Set<string>();
  for (const m of open) {
    mentorLoad.set(m.mentorId, (mentorLoad.get(m.mentorId) ?? 0) + 1);
    matchedMentees.add(m.menteeId);
    openPairs.add([m.mentorId, m.menteeId].sort().join(":"));
  }
  const ctx: PairContext = {
    today: new Date().toISOString().slice(0, 10),
    rejectedPairs: new Set(rejected.map((r) => pairKey(r.mentorId, r.menteeId))),
  };
  return { open, mentorLoad, matchedMentees, openPairs, ctx };
}

/** Flips pending matches older than 14 days to expired, freeing both officers. */
export async function expirePending(db: Db, actorId: string | null) {
  const cutoff = new Date(Date.now() - PENDING_EXPIRY_DAYS * 86400_000);
  const expired = await db
    .update(matches)
    .set({ status: "expired", endedAt: new Date() })
    .where(and(eq(matches.status, "pending_approval"), lt(matches.createdAt, cutoff)))
    .returning({ id: matches.id });
  if (expired.length) {
    await db.insert(auditEvents).values(
      expired.map((m) => ({ matchId: m.id, actorId, action: "expire", note: `pending > ${PENDING_EXPIRY_DAYS} days` })),
    );
  }
  return expired.length;
}

/** Open matches involving any of these users (as either side). */
export async function openMatchesFor(db: Db, userIds: string[]) {
  if (!userIds.length) return [];
  return db
    .select()
    .from(matches)
    .where(
      and(
        inArray(matches.status, [...OPEN_STATUSES]),
        or(inArray(matches.mentorId, userIds), inArray(matches.menteeId, userIds)),
      ),
    );
}
