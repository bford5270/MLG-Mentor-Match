// Single source of truth for profile choices; the PWA loads these from
// GET /api/options so the form and the validator never drift apart.

export const SERVICES = [
  { value: "usmc", label: "USMC" },
  { value: "usn", label: "USN" },
] as const;

// Seniority order matters: index is used for the grade-gap rule in matching.
export const GRADES = ["W-1", "W-2", "W-3", "W-4", "W-5", "O-1", "O-2", "O-3", "O-4", "O-5", "O-6"] as const;

export const UNITS = [
  "1st MLG HQ",
  "CLR-1",
  "CLR-15",
  "CLR-17",
  "1st Medical Battalion",
  "1st Dental Battalion",
  "Other",
] as const;

export const COMMISSIONING_SOURCES = [
  "USNA",
  "NROTC",
  "OCS",
  "PLC",
  "MECEP",
  "ECP",
  "USUHS",
  "HPSP / direct commission",
  "Warrant officer program",
  "Other",
] as const;

export const CAREER_GOALS = [
  "Command",
  "Resident PME",
  "Augmentation / retention",
  "Lateral move or redesignation",
  "Graduate education",
  "Residency / fellowship",
  "Joint or staff assignment",
  "Transition / separation",
  "Undecided",
] as const;

export const LEADERSHIP_INTERESTS = [
  "Counseling and developing subordinates",
  "Small-unit leadership",
  "Staff work and writing",
  "Operational planning",
  "Logistics and sustainment",
  "Leading through deployments",
  "Working with senior leaders",
  "Public speaking and briefing",
  "Ethics and hard decisions",
] as const;

export const PERSONAL_FACTORS = [
  "Dual-military",
  "Parent",
  "Geographic bachelor",
  "Prior enlisted",
  "First-generation officer",
] as const;

export const MENTORSHIP_ROLES = [
  { value: "mentee", label: "Find a mentor" },
  { value: "mentor", label: "Be a mentor" },
  { value: "both", label: "Both" },
] as const;

export function gradeRank(grade: string): number {
  return (GRADES as readonly string[]).indexOf(grade);
}
