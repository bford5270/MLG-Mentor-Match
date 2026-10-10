import { describe, expect, it } from "vitest";
import { type Candidate, hardRuleViolation, inSameChain, pairKey, proposeBatch, scorePair, seniorityOk } from "../src/domain/matching.js";

let n = 0;
function officer(over: Partial<Candidate> = {}): Candidate {
  n++;
  return {
    userId: `u${String(n).padStart(3, "0")}`,
    rosterId: `r${n}`,
    name: `Officer ${n}`,
    service: "usmc",
    grade: "O-3",
    mosOrDesignator: "0402",
    unit: "CLR-1",
    section: null,
    reportingSeniorRosterId: null,
    reviewingOfficerRosterId: null,
    prd: "2030-01-01",
    commissioningSource: null,
    mentorshipRole: "both",
    mentorCapacity: 1,
    careerGoals: [],
    leadershipInterests: [],
    personalFactors: [],
    ...over,
  };
}
const ctx = { today: "2026-10-10", rejectedPairs: new Set<string>() };
const empty = { mentorLoad: new Map(), matchedMentees: new Set<string>(), openPairs: new Set<string>(), ctx };

describe("seniority", () => {
  it.each([
    ["O-3", "O-1", true],
    ["O-2", "O-1", false], // O-1/O-2 mentees need a 2-grade gap
    ["O-4", "O-2", true],
    ["O-4", "O-3", true],
    ["O-3", "O-3", false],
    ["W-3", "W-2", true],
    ["O-3", "W-4", true],
    ["O-2", "W-1", false],
    ["W-5", "O-1", false], // warrants don't mentor commissioned officers
  ])("%s mentoring %s → %s", (mentor, mentee, ok) => {
    expect(seniorityOk(mentor, mentee)).toBe(ok);
  });
});

describe("hard rules", () => {
  it("blocks RS/RO in either direction and same section", () => {
    const senior = officer({ grade: "O-5" });
    const junior = officer({ grade: "O-2", reportingSeniorRosterId: senior.rosterId });
    expect(inSameChain(senior, junior)).toBe(true);
    expect(inSameChain(officer({ section: "S-4" }), officer({ section: " s-4 " }))).toBe(true);
    expect(inSameChain(officer({ section: "S-4" }), officer({ section: "S-4", unit: "CLR-15" }))).toBe(false);
    expect(hardRuleViolation(senior, junior, ctx)).toBe("same chain of command");
  });

  it("requires 6 months of PRD for both", () => {
    expect(hardRuleViolation(officer({ grade: "O-5", prd: "2027-02-01" }), officer({ grade: "O-2" }), ctx)).toMatch(/mentor's PRD/);
    expect(hardRuleViolation(officer({ grade: "O-5" }), officer({ grade: "O-2", prd: "2027-04-12" }), ctx)).toBeNull();
  });

  it("respects roles and prior rejections", () => {
    const mentor = officer({ grade: "O-5", mentorshipRole: "mentee" });
    expect(hardRuleViolation(mentor, officer({ grade: "O-2" }), ctx)).toBe("not signed up to mentor");
    const a = officer({ grade: "O-5" });
    const b = officer({ grade: "O-2" });
    expect(hardRuleViolation(a, b, { ...ctx, rejectedPairs: new Set([pairKey(a.userId, b.userId)]) })).toBe("previously rejected");
  });
});

describe("scoring", () => {
  it("rewards shared community, goals and source", () => {
    const strong = scorePair(
      officer({ careerGoals: ["Command"], commissioningSource: "USNA" }),
      officer({ careerGoals: ["Command"], commissioningSource: "USNA" }),
    );
    const weak = scorePair(officer({ mosOrDesignator: "3002" }), officer({ mosOrDesignator: "0402" }));
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/Career goals: Command/), expect.stringMatching(/USNA/)]));
  });
});

describe("batch", () => {
  it("prefers same service and only falls back to cross-service", () => {
    const usmcMentor = officer({ grade: "O-5", mentorshipRole: "mentor", mosOrDesignator: "2100" });
    const navyMentor = officer({ grade: "O-5", service: "usn", mentorshipRole: "mentor", mosOrDesignator: "2100" });
    const navyMentee = officer({ grade: "O-2", service: "usn", mentorshipRole: "mentee", mosOrDesignator: "2100" });
    const usmcMentee = officer({ grade: "O-2", mentorshipRole: "mentee" });
    const out = proposeBatch({ ...empty, candidates: [usmcMentor, navyMentor, navyMentee, usmcMentee] });
    const pairs = out.map((p) => [p.mentorId, p.menteeId, p.crossService]);
    expect(pairs).toContainEqual([navyMentor.userId, navyMentee.userId, false]);
    expect(pairs).toContainEqual([usmcMentor.userId, usmcMentee.userId, false]);

    const lonelyNavy = officer({ grade: "O-2", service: "usn", mentorshipRole: "mentee" });
    const out2 = proposeBatch({ ...empty, candidates: [usmcMentor, lonelyNavy] });
    expect(out2).toEqual([expect.objectContaining({ mentorId: usmcMentor.userId, menteeId: lonelyNavy.userId, crossService: true })]);
  });

  it("honors capacity, existing load, and one mentor per mentee", () => {
    const mentor = officer({ grade: "O-5", mentorshipRole: "mentor", mentorCapacity: 2 });
    const mentees = [1, 2, 3].map(() => officer({ grade: "O-2", mentorshipRole: "mentee" }));
    expect(proposeBatch({ ...empty, candidates: [mentor, ...mentees] })).toHaveLength(2);
    const loaded = proposeBatch({ ...empty, mentorLoad: new Map([[mentor.userId, 2]]), candidates: [mentor, ...mentees] });
    expect(loaded).toHaveLength(0);
  });

  it("never pairs two 'both' officers twice in opposite directions", () => {
    const a = officer({ grade: "O-5" });
    const b = officer({ grade: "O-2" });
    const c = officer({ grade: "O-6" });
    const out = proposeBatch({ ...empty, candidates: [a, b, c] });
    const keys = out.map((p) => [p.mentorId, p.menteeId].sort().join(":"));
    expect(new Set(keys).size).toBe(keys.length);
    // Every mentee appears at most once.
    expect(new Set(out.map((p) => p.menteeId)).size).toBe(out.length);
  });
});
