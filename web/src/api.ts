export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "Something went wrong", data.fields);
  return data as T;
}

export type Role = "officer" | "approver" | "admin";

export interface Profile {
  name: string;
  service: "usmc" | "usn";
  grade: string;
  mosOrDesignator: string;
  unit: string;
  section: string | null;
  reportingSeniorRosterId: string | null;
  reviewingOfficerRosterId: string | null;
  prd: string;
  commissioningSource: string | null;
  mentorshipRole: "mentor" | "mentee" | "both";
  mentorCapacity: number;
  careerGoals: string[];
  leadershipInterests: string[];
  personalFactors: string[];
  bio: string | null;
}

export interface Me {
  user: { id: string; email: string; role: Role; safetyAcknowledged: boolean };
  roster: { name: string; service: "usmc" | "usn"; grade: string; unit: string | null } | null;
  profile: Profile | null;
  people: { id: string; name: string; grade: string }[];
}

export interface Options {
  services: { value: string; label: string }[];
  grades: string[];
  units: string[];
  commissioningSources: string[];
  careerGoals: string[];
  leadershipInterests: string[];
  personalFactors: string[];
  mentorshipRoles: { value: string; label: string }[];
}
