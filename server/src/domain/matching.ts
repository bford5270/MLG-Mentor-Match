// Pure matching logic: hard rules, scoring, and the greedy batch assignment.
// No database access here, so every rule is unit-testable.

import { gradeRank } from "./options.js";

export interface Candidate {
  userId: string;
  /** The officer's own roster entry, used for chain-of-command checks. */
  rosterId: string | null;
  name: string;
  service: "usmc" | "usn";
  grade: string;
  mosOrDesignator: string;
  unit: string;
  section: string | null;
  reportingSeniorRosterId: string | null;
  reviewingOfficerRosterId: string | null;
  prd: string; // YYYY-MM-DD
  commissioningSource: string | null;
  mentorshipRole: "mentor" | "mentee" | "both";
  mentorCapacity: number;
  careerGoals: string[];
  leadershipInterests: string[];
  personalFactors: string[];
}

export interface PairContext {
  /** ISO date; PRDs must be at least MIN_PRD_DAYS after it. */
  today: string;
  /** "mentorId:menteeId" for pairs that were rejected before (never re-proposed). */
  rejectedPairs: Set<string>;
}

export const MIN_PRD_DAYS = 182;
export const PENDING_EXPIRY_DAYS = 14;

export const pairKey = (mentorId: string, menteeId: string) => `${mentorId}:${menteeId}`;

const isWarrant = (grade: string) => grade.startsWith("W-");

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Seniority rule. Commissioned mentees need a commissioned mentor one grade
 * senior (two for O-1/O-2). Warrant mentees need a more senior warrant or an
 * O-3 and above. Warrant officers don't mentor commissioned officers.
 */
export function seniorityOk(mentorGrade: string, menteeGrade: string): boolean {
  const mentor = gradeRank(mentorGrade);
  const mentee = gradeRank(menteeGrade);
  if (mentor < 0 || mentee < 0) return false;
  if (isWarrant(menteeGrade)) {
    return isWarrant(mentorGrade) ? mentor > mentee : mentor >= gradeRank("O-3");
  }
  if (isWarrant(mentorGrade)) return false;
  const gap = menteeGrade === "O-1" || menteeGrade === "O-2" ? 2 : 1;
  return mentor - mentee >= gap;
}

/** True when either officer is the other's RS/RO, or they share a section. */
export function inSameChain(a: Candidate, b: Candidate): boolean {
  const rates = (senior: Candidate, junior: Candidate) =>
    senior.rosterId !== null &&
    (junior.reportingSeniorRosterId === senior.rosterId || junior.reviewingOfficerRosterId === senior.rosterId);
  if (rates(a, b) || rates(b, a)) return true;
  const section = (c: Candidate) => c.section?.trim().toLowerCase() || null;
  return a.unit === b.unit && section(a) !== null && section(a) === section(b);
}

/** Every hard rule. Returns the first violated rule, or null when the pair is allowed. */
export function hardRuleViolation(mentor: Candidate, mentee: Candidate, ctx: PairContext): string | null {
  if (mentor.userId === mentee.userId) return "same person";
  if (mentor.mentorshipRole === "mentee") return "not signed up to mentor";
  if (mentee.mentorshipRole === "mentor") return "not signed up for a mentor";
  if (!seniorityOk(mentor.grade, mentee.grade)) return "grade gap too small";
  if (inSameChain(mentor, mentee)) return "same chain of command";
  const minPrd = addDays(ctx.today, MIN_PRD_DAYS);
  if (mentor.prd < minPrd) return "mentor's PRD is less than 6 months away";
  if (mentee.prd < minPrd) return "mentee's PRD is less than 6 months away";
  if (ctx.rejectedPairs.has(pairKey(mentor.userId, mentee.userId))) return "previously rejected";
  return null;
}

/** Occupational field: first two digits of a MOS (04xx) or designator (21xx). */
const community = (code: string) => code.replace(/\D/g, "").slice(0, 2) || null;

function overlap(a: string[], b: string[]) {
  const shared = a.filter((x) => b.includes(x));
  const union = new Set([...a, ...b]).size;
  return { shared, ratio: union === 0 ? 0 : shared.length / union };
}

export interface Score {
  score: number; // 0–100
  reasons: string[];
}

/** Equal-weight score across five dimensions (pilot: no per-user weights). */
export function scorePair(mentor: Candidate, mentee: Candidate): Score {
  const reasons: string[] = [];
  let total = 0;

  const field = community(mentor.mosOrDesignator) !== null && community(mentor.mosOrDesignator) === community(mentee.mosOrDesignator);
  if (field) {
    total += 1;
    reasons.push(`Same community (${mentor.mosOrDesignator} / ${mentee.mosOrDesignator})`);
  }

  const goals = overlap(mentor.careerGoals, mentee.careerGoals);
  total += goals.ratio;
  if (goals.shared.length) reasons.push(`Career goals: ${goals.shared.join(", ")}`);

  const topics = overlap(mentor.leadershipInterests, mentee.leadershipInterests);
  total += topics.ratio;
  if (topics.shared.length) reasons.push(`Leadership topics: ${topics.shared.join(", ")}`);

  if (mentor.commissioningSource && mentor.commissioningSource === mentee.commissioningSource && mentor.commissioningSource !== "Other") {
    total += 1;
    reasons.push(`Both commissioned via ${mentor.commissioningSource}`);
  }

  const factors = overlap(mentor.personalFactors, mentee.personalFactors);
  total += factors.ratio;
  if (factors.shared.length) reasons.push(`Shared background: ${factors.shared.join(", ")}`);

  return { score: Math.round((total / 5) * 100), reasons };
}

export interface ProposedPair extends Score {
  mentorId: string;
  menteeId: string;
  crossService: boolean;
}

export interface BatchInput {
  candidates: Candidate[];
  /** Open (pending or active) matches per mentor. */
  mentorLoad: Map<string, number>;
  /** Mentees who already have an open match as mentee. */
  matchedMentees: Set<string>;
  /** Unordered pairs that already have an open match in either direction. */
  openPairs: Set<string>;
  ctx: PairContext;
}

/**
 * Greedy assignment, best score first. Pass 1 pairs within a service; pass 2
 * offers cross-service mentors only to mentees still unmatched after pass 1.
 */
export function proposeBatch(input: BatchInput): ProposedPair[] {
  const load = new Map(input.mentorLoad);
  const matched = new Set(input.matchedMentees);
  const open = new Set(input.openPairs);
  const mentors = input.candidates.filter((c) => c.mentorshipRole !== "mentee");
  const mentees = input.candidates.filter((c) => c.mentorshipRole !== "mentor");
  const proposals: ProposedPair[] = [];

  for (const crossService of [false, true]) {
    const options: ProposedPair[] = [];
    for (const mentee of mentees) {
      if (matched.has(mentee.userId)) continue;
      for (const mentor of mentors) {
        if ((mentor.service !== mentee.service) !== crossService) continue;
        if (hardRuleViolation(mentor, mentee, input.ctx)) continue;
        options.push({ mentorId: mentor.userId, menteeId: mentee.userId, crossService, ...scorePair(mentor, mentee) });
      }
    }
    options.sort((a, b) => b.score - a.score || a.menteeId.localeCompare(b.menteeId) || a.mentorId.localeCompare(b.mentorId));

    const capacity = new Map(mentors.map((m) => [m.userId, m.mentorCapacity]));
    for (const option of options) {
      if (matched.has(option.menteeId)) continue;
      if ((load.get(option.mentorId) ?? 0) >= (capacity.get(option.mentorId) ?? 0)) continue;
      const unordered = [option.mentorId, option.menteeId].sort().join(":");
      if (open.has(unordered)) continue;
      proposals.push(option);
      matched.add(option.menteeId);
      load.set(option.mentorId, (load.get(option.mentorId) ?? 0) + 1);
      open.add(unordered);
    }
  }
  return proposals;
}

/** Top alternatives for one side of a pending match, for the approval queue. */
export function alternatesFor(
  fixed: Candidate,
  side: "mentor" | "mentee",
  pool: Candidate[],
  ctx: PairContext,
  excludeIds: Set<string>,
  limit = 3,
) {
  return pool
    .filter((c) => !excludeIds.has(c.userId))
    .map((c) => {
      const [mentor, mentee] = side === "mentor" ? [c, fixed] : [fixed, c];
      if (hardRuleViolation(mentor, mentee, ctx)) return null;
      return { candidate: c, crossService: c.service !== fixed.service, ...scorePair(mentor, mentee) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => Number(a.crossService) - Number(b.crossService) || b.score - a.score)
    .slice(0, limit);
}
