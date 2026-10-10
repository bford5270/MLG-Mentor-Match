// Default officership touch points (see PLAN.md). Seeded into the
// `touchpoints` table on startup if missing; after that the G-10 edits them
// in the app and this file is only the starting point.

export interface TouchpointSeed {
  id: string;
  sequence: number;
  offsetDays: number | null;
  daysBeforeEnd: number | null;
  title: string;
  body: string;
  questions: string[];
}

export const CURRICULUM: TouchpointSeed[] = [
  {
    id: "week-0-kickoff",
    sequence: 1,
    offsetDays: 0,
    daysBeforeEnd: null,
    title: "Kickoff & expectations",
    body:
      "Welcome to your mentorship. Set up a first conversation in the next two weeks: a call, coffee, or a walk. Agree on how often you'll meet (every 2–4 weeks works well) and how you'll stay in touch between meetings.",
    questions: [
      "What does each of you want to get out of this mentorship?",
      "What's the best way and time to reach each other?",
      "What's one goal for the mentee over the next six months?",
      "What topics are off the table, if any?",
    ],
  },
  {
    id: "week-2-philosophy",
    sequence: 2,
    offsetDays: 14,
    daysBeforeEnd: null,
    title: "Leadership philosophy",
    body:
      "Talk about how each of you leads. Mentors: share the leaders who shaped you, good and bad. Mentees: try putting your own leadership philosophy into a few sentences, even if it's a first draft.",
    questions: [
      "Who was the best leader you've served under, and what did they do differently?",
      "Which leadership traits or principles do you lean on most? Which do you find hardest?",
      "How do you want your Marines or Sailors to describe you when you leave?",
    ],
  },
  {
    id: "month-1-evaluations",
    sequence: 3,
    offsetDays: 30,
    daysBeforeEnd: null,
    title: "Evaluations & counseling",
    body:
      "Talk through how evaluations and counseling really work: what makes a strong FITREP, how to prepare for initial and mid-term counseling, and how to give honest feedback to your own people.",
    questions: [
      "What should the mentee be doing now to set up their next FITREP well?",
      "How do you prepare for a counseling session, as the senior and as the junior?",
      "Tell a story about feedback that was hard to give or hear, and what came of it.",
    ],
  },
  {
    id: "month-2-development",
    sequence: 4,
    offsetDays: 60,
    daysBeforeEnd: null,
    title: "Professional development",
    body:
      "Look at PME, professional reading and communication skills. Pick one book or article from the Commandant's or CNO's reading list to discuss next time.",
    questions: [
      "Where is the mentee on their PME roadmap, and what's next?",
      "What's one book that changed how you think about leadership or your profession?",
      "How can the mentee get better at writing and briefing in their current billet?",
    ],
  },
  {
    id: "month-3-midpoint",
    sequence: 5,
    offsetDays: 90,
    daysBeforeEnd: null,
    title: "Mid-point reflection",
    body:
      "Check in on the goals you set at kickoff. Be honest about what's working in the mentorship and what isn't, and adjust how you meet if you need to.",
    questions: [
      "What progress has the mentee made on their goal?",
      "Is the meeting rhythm working? What would make your conversations more useful?",
      "What's changed in the mentee's billet or plans since you started?",
    ],
  },
  {
    id: "month-4-career",
    sequence: 6,
    offsetDays: 120,
    daysBeforeEnd: null,
    title: "Career roadmap",
    body:
      "Map out the next few years: career milestones, billets to aim for, and timing. Talk about how to have productive conversations with a monitor or detailer.",
    questions: [
      "What are the milestones for the mentee's community, and when do they fall?",
      "What billet would the mentee want next, and what makes them competitive for it?",
      "What do you wish someone had told you about career planning at this point?",
    ],
  },
  {
    id: "month-6-ethics",
    sequence: 7,
    offsetDays: 180,
    daysBeforeEnd: null,
    title: "Ethics & hard calls",
    body:
      "Talk about integrity under pressure and decisions without a clear right answer. Keep examples general: no names, no details that identify people or units.",
    questions: [
      "Describe a hard call you've had to make. How did you decide?",
      "How do you handle pressure from above to do something you disagree with?",
      "How do you balance mission accomplishment with taking care of your people?",
    ],
  },
  {
    id: "month-9-resilience",
    sequence: 8,
    offsetDays: 270,
    daysBeforeEnd: null,
    title: "Resilience & balance",
    body:
      "Talk about sustaining yourself and your family through a demanding career: workups, deployments, long hours and transitions.",
    questions: [
      "What habits keep you effective over the long haul?",
      "How have you managed family and personal priorities alongside the job?",
      "What resources should the mentee know about, for themselves and their people?",
    ],
  },
  {
    id: "month-12-completion",
    sequence: 9,
    offsetDays: 365,
    daysBeforeEnd: null,
    title: "One year: looking back & paying it forward",
    body:
      "Look back at where you started. Decide together whether to keep meeting. Mentees: consider mentoring a junior officer yourself.",
    questions: [
      "What has been most valuable about this mentorship?",
      "Which goals were met, and what's next?",
      "Who could the mentee mentor, formally or informally?",
    ],
  },
  {
    id: "prd-transition",
    sequence: 10,
    offsetDays: null,
    daysBeforeEnd: 60,
    title: "Transition",
    body:
      "One of you PCSes or separates in about two months, and the formal match ends then. Plan a good handoff and decide how you'll stay in touch.",
    questions: [
      "What advice does the mentor have for the next duty station or transition?",
      "What should the mentee keep working on after the match ends?",
      "Would the mentee like a new mentor afterward? Tell the G-10 if so.",
    ],
  },
];

/** The chat card text for a touch point. */
export function formatTouchpoint(t: { title: string; body: string; questions: string[] }) {
  const questions = t.questions.map((q) => `• ${q}`).join("\n");
  return `📋 ${t.title}\n\n${t.body}${questions ? `\n\nTo talk about:\n${questions}` : ""}`;
}
