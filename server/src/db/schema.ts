import {
  boolean,
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const serviceEnum = pgEnum("service", ["usmc", "usn"]);
export const roleEnum = pgEnum("role", ["officer", "approver", "admin"]);
export const mentorshipRoleEnum = pgEnum("mentorship_role", ["mentor", "mentee", "both"]);
export const matchStatusEnum = pgEnum("match_status", [
  "pending_approval",
  "active",
  "rejected",
  "expired",
  "reassigned",
  "ended",
]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// Officers allowed to register. Loaded by an admin from the unit's officer
// roster; sign-in codes are only ever sent to addresses on this list.
export const roster = pgTable("roster", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(), // stored lowercased
  name: text("name").notNull(),
  service: serviceEnum("service").notNull(),
  grade: text("grade").notNull(), // "O-1" … "O-6", "W-1" … "W-5"
  unit: text("unit"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: roleEnum("role").notNull().default("officer"),
  safetyAcknowledgedAt: timestamp("safety_acknowledged_at", { withTimezone: true }),
  /** Last "you have unread messages" email, so the fallback doesn't nag. */
  lastUnreadEmailAt: timestamp("last_unread_email_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  service: serviceEnum("service").notNull(),
  grade: text("grade").notNull(),
  mosOrDesignator: text("mos_or_designator").notNull(),
  unit: text("unit").notNull(), // subordinate command, e.g. "CLR-1", "1st Med Bn"
  section: text("section"),
  // Roster entries, not users: the RS/RO may never register themselves.
  reportingSeniorRosterId: uuid("reporting_senior_roster_id").references(() => roster.id),
  reviewingOfficerRosterId: uuid("reviewing_officer_roster_id").references(() => roster.id),
  prd: date("prd").notNull(), // projected rotation date (or EAS, whichever is sooner)
  commissioningSource: text("commissioning_source"),
  mentorshipRole: mentorshipRoleEnum("mentorship_role").notNull(),
  mentorCapacity: integer("mentor_capacity").notNull().default(1),
  careerGoals: jsonb("career_goals").$type<string[]>().notNull().default([]),
  leadershipInterests: jsonb("leadership_interests").$type<string[]>().notNull().default([]),
  personalFactors: jsonb("personal_factors").$type<string[]>().notNull().default([]),
  bio: text("bio"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const loginCodes = pgTable("login_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  mentorId: uuid("mentor_id").notNull().references(() => users.id),
  menteeId: uuid("mentee_id").notNull().references(() => users.id),
  status: matchStatusEnum("status").notNull().default("pending_approval"),
  score: real("score"),
  crossService: boolean("cross_service").notNull().default(false),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  approvedBy: uuid("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  endsOn: date("ends_on"), // earlier of the two PRDs
  endedAt: timestamp("ended_at", { withTimezone: true }),
  previousMatchId: uuid("previous_match_id"),
  createdAt: createdAt(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").references(() => matches.id),
  actorId: uuid("actor_id").references(() => users.id), // null = system/scheduler
  action: text("action").notNull(),
  note: text("note"),
  data: jsonb("data"),
  createdAt: createdAt(),
});

// Chat content. No admin route ever selects from this table; access is
// limited to the two participants of the match.
export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").references(() => users.id), // null = system touch-point card
  body: text("body").notNull(),
  touchpointId: text("touchpoint_id").references(() => touchpoints.id),
  createdAt: createdAt(),
});

export const messageReads = pgTable(
  "message_reads",
  {
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);

// Editable officership curriculum (see PLAN.md "Touch points").
export const touchpoints = pgTable("touchpoints", {
  id: text("id").primaryKey(), // e.g. "week-0-kickoff"
  sequence: integer("sequence").notNull(),
  offsetDays: integer("offset_days"), // days after approval; null for PRD-driven
  daysBeforeEnd: integer("days_before_end"), // e.g. 60 for the transition prompt
  title: text("title").notNull(),
  body: text("body").notNull(),
  questions: jsonb("questions").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
});

export const touchpointDeliveries = pgTable(
  "touchpoint_deliveries",
  {
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    touchpointId: text("touchpoint_id").notNull().references(() => touchpoints.id),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
    discussedAt: timestamp("discussed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.touchpointId] })],
);

// A report carries only what the reporter writes (plus messages they chose
// to attach) — never admin access to the conversation.
export const reports = pgTable("reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  matchId: uuid("match_id").notNull().references(() => matches.id),
  reporterId: uuid("reporter_id").notNull().references(() => users.id),
  description: text("description").notNull(),
  attachedMessages: jsonb("attached_messages").$type<{ sentAt: string; from: string; body: string }[]>(),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
});

// End-of-match feedback, written for the program (visible to the G-10).
export const matchFeedback = pgTable(
  "match_feedback",
  {
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(), // 1–5: how valuable was it
    wouldRecommend: boolean("would_recommend").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] })],
);
