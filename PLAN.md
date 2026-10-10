# 1st MLG Mentor Match — Build Plan

A mobile-only mentorship app for the officers of **1st Marine Logistics Group**, including the officers of **1st Medical Battalion**. It is a rebuild of the USAFP MentorMatch idea, with no legacy-site import, a different population, and in-app chat in place of the email cadence.

## Decisions so far

| Topic | Decision |
|---|---|
| Population | Officers only (Marine officers across 1st MLG + Navy officers of 1st Med Bn). SNCOs/enlisted possibly later. |
| Matching | Algorithm proposes, an admin approves each pair. **Same-service preferred** (Marine↔Marine, Navy↔Navy), cross-service allowed only as a fallback. |
| Approver | **The G-10** approves matches. The approver role is assigned in the app, so it moves with turnover. |
| Chat | In-app 1:1 chat between the matched pair. **Admins cannot read chats**, including reported ones. See the Reporting section. |
| Devices | **Personal phones only.** No government devices, no CAC. |
| Platform | Installable PWA (mobile-only layout). Revisit an Expo native wrapper after the pilot if iOS push adoption is poor. |
| Hosting | **Railway, Hobby plan (~$5/mo)**, with a usage limit set. One Node/Hono service (API + websockets + PWA files) and Railway Postgres. No Supabase. |
| Touch points | Periodic guided prompts like USAFP's cadence, rewritten around **general officership** rather than medicine. |

## What carries over from USAFP, and what doesn't

**Reused (ported to Node):**
- The weighted scoring + greedy matcher.
- The match lifecycle (`pending_approval → active → rejected / expired / reassigned / ended`), the 14-day pending expiry, the append-only audit log.
- The admin queue (Approve / Reject / Reassign / Defer, top-3 alternates), manual match, reassigning an active match, and the weekly admin digest.
- The cadence engine. It now posts prompts into chat and sends a push notification instead of emailing.

**Dropped:** the scraper/bulk import, `legacyMissing`/`legacyBranch`, the duplicate-user archive tooling, branch pools as a hard wall, and most Resend delivery tracking.

## Matching

**Hard rules** (a pair is never proposed if one fails):
1. **No reporting-chain matches.** A mentor may not sit in the mentee's chain of command: same section/company with a senior–subordinate relationship, or the mentee's reporting senior or reviewing officer. Profiles capture unit/subordinate command and reporting senior.
2. **Grade gap.** The mentor must be at least one grade senior (configurable; default 2 for O-1/O-2 mentees).
3. **PRD overlap.** Both officers must have at least 6 months left before their PRD/EAS.
4. **Capacity.** Each mentor sets a max number of mentees (default 1, max 3).

**Same-service preference.** Matching runs a same-service pass first. A mentee who is still unmatched after the same-service pass is eligible for cross-service candidates in the next pass. Those proposals are flagged *"cross-service"* in the G-10's queue, so they are a visible, deliberate choice.

**Scored dimensions** (equal weights for the pilot, like USAFP's `PILOT_EQUAL_WEIGHTS`):
- MOS / designator community (e.g., 04xx logistics, 30xx supply, 0402, 1302; Navy 2100/2900/2300)
- Career goals: command, resident PME, augmentation/retention, lateral move or redesignation, transition/separation, graduate education, residency/fellowship
- Leadership interests: counseling, small-unit leadership, staff work, planning, etc.
- Commissioning source
- Personal factors (opt-in): dual-military, family, geographic-bachelor, etc.

## Touch points (officership curriculum)

USAFP sent at weeks 0/4/8/13/26/52. MLG keeps that rhythm and adds a PRD-driven transition prompt. Each touch point arrives as a system card in the pair's chat (suggested agenda + 3–5 discussion questions) and as a push notification to both officers. A "mark as discussed" button feeds the G-10's aggregate (not content) metrics.

| When | Theme | Focus |
|---|---|---|
| Week 0 | Kickoff & expectations | Introductions, meeting rhythm, what each wants out of it, draft individual goals |
| Week 2 | Leadership philosophy | Each officer's leadership philosophy; leaders who shaped them; leadership traits and principles |
| Month 1 | Evaluations & counseling | How FITREPs work (Marine and Navy), giving and receiving counseling, initial/mid-term counseling |
| Month 2 | Professional development | PME roadmap, professional reading (Commandant's / CNO reading lists), writing and briefing well |
| Month 3 | Mid-point reflection | Progress on goals, adjust the plan, honest check on whether the match is working |
| Month 4 | Career roadmap | Career milestones and timing, billet planning, augmentation/retention, monitor/detailer conversations |
| Month 6 | Ethics & hard calls | Integrity under pressure, tough leadership decisions, taking care of Marines and Sailors |
| Month 9 | Resilience & balance | Family, wellness, sustaining performance through deployments and workups |
| Month 12 | Completion & paying it forward | Look back at goals; mentee considers mentoring a junior officer |
| PRD − 60 days | Transition | Handoff before either officer PCSes: next-duty-station advice, staying in touch, closing the match |

Content is stored as editable data (not hard-coded), so the G-10 can revise prompts without a deploy. Wording will be aligned to current Marine Corps leader-development guidance and reviewed by the G-10 before the pilot.

## Privacy, OPSEC, and reporting

- **Admins cannot read chats.** There is no admin endpoint that returns message content, and access is enforced in the API with automated tests proving one user cannot read another pair's messages.
- **Reporting without reading.** Either officer can *report* a concern. The report contains only what the reporter types plus a match reference; the G-10 can then contact them, pause or end the match, or reassign. Optionally, the reporter can choose to attach specific messages. That attachment is the reporter's decision, not admin access.
- **Block / end match** is always available to either party.
- **Banner** on first launch and atop chat: *Unclassified only. No CUI, no PII about others, no operational details.* Acknowledged at sign-up.
- **Retention:** messages are deleted 30 days after a match ends (configurable).
- **Personal phones only:** sign-in is by emailed code. Officers register with the email they actually read on their phone (personal or .mil); the roster stores which.
- Run the unit name and insignia past Public Affairs before any public-facing use.

## Architecture (Railway)

```
Railway project
├── app       Node 22 + Hono
│             • REST API            /api/*
│             • websocket chat      /ws
│             • static PWA          /*   (Vite build output)
│             • in-process scheduler (touch points, expiry, PRD end, digest, purge, backup)
└── postgres  Railway Postgres (Drizzle ORM + migrations)
```

- **Auth:** roster-gated 6-digit email codes (10-minute expiry, hashed, attempt-limited), then a signed httpOnly session cookie. Roles: `officer`, `approver` (G-10), `admin`.
- **Email:** Resend (free tier) for sign-in codes and unread-message fallback only.
- **Push:** `web-push` with our own VAPID keys. On iOS this requires "Add to Home Screen" (iOS 16.4+); onboarding walks users through it.
- **Tables:** `roster`, `users`, `profiles`, `login_codes`, `sessions`, `matches`, `audit_events`, `messages`, `touchpoints`, `touchpoint_deliveries`, `reports`, `push_subscriptions`, `settings`.
- **Cost control:** usage limit set in Railway; expected ~$5–8/mo.

## Phases

| Phase | Scope | Effort |
|---|---|---|
| 0. Scaffold | Repo layout (`server/` + `web/`), Drizzle schema + first migration, PWA shell, health endpoint, Railway config | 2–3 days |
| 1. Auth + profiles | Roster upload (CSV) by admin, email-code sign-in, sessions, onboarding profile, safety banner acknowledgment | 1 week |
| 2. Matching + G-10 queue | Port scorer with new dimensions + hard rules + same-service-first passes; batch match; mobile approval queue | 1–1.5 weeks |
| 3. Chat | Websocket chat, history, unread badges, report/block/end, access tests | 1–1.5 weeks |
| 4. Push + touch points | VAPID push, touch-point engine, editable curriculum, email fallback | 1 week |
| 5. Lifecycle + ops | PRD auto-end, end-of-match feedback, weekly G-10 digest, retention purge, backups | 1 week |
| 6. Pilot | 10–20 pairs; measure sign-up, push opt-in, touch-point completion; decide on native wrapper | — |

## Still open

1. **Email sending domain:** a subdomain of `usafpmemberservices.info` (e.g. `mlg.usafpmemberservices.info`) or a new domain (~$12/yr).
2. **App URL:** the free `*.up.railway.app` address or a custom domain.
3. **Mentor capacity** default (1 mentee each?) and the minimum grade gap.
4. **Roster source:** who provides the officer roster (G-1 / S-1 export), and how often it is refreshed.
