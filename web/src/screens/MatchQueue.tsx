import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, inputClass, Screen } from "../components/ui";

interface Officer {
  userId: string;
  name: string;
  service: "usmc" | "usn";
  grade: string;
  mosOrDesignator: string;
  unit: string;
  section: string | null;
  prd: string;
  mentorshipRole: string;
  careerGoals: string[];
}
interface Alternate extends Officer {
  score: number;
  reasons: string[];
  crossService: boolean;
}
interface Pending {
  id: string;
  createdAt: string;
  score: number | null;
  reasons: string[];
  crossService: boolean;
  mentor: Officer;
  mentee: Officer;
  alternates: { mentor: Alternate[]; mentee: Alternate[] };
}
interface Overview {
  queue: Pending[];
  active: { id: string; endsOn: string | null; crossService: boolean; mentor: Officer; mentee: Officer }[];
  unmatchedMentees: Officer[];
  openMentors: Officer[];
  lastRunAt: string | null;
}

const svc = (s: string) => (s === "usn" ? "USN" : "USMC");
const who = (o: Officer) => `${o.grade} ${o.name}`;
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);

function OfficerLine({ label, o }: { label: string; o: Officer }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="font-medium text-slate-900">{who(o)}</p>
      <p className="text-sm text-slate-600">
        {svc(o.service)} · {o.mosOrDesignator} · {o.unit}
        {o.section ? ` / ${o.section}` : ""}
      </p>
    </div>
  );
}

function CrossBadge() {
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Cross-service</span>;
}

function PendingCard({ m, act }: { m: Pending; act: (path: string, body?: unknown) => Promise<void> }) {
  const [showAlts, setShowAlts] = useState(false);
  const age = daysAgo(m.createdAt);
  return (
    <li className="space-y-3 rounded-lg border border-slate-300 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-600">
          Score {m.score ?? "—"} · {age === 0 ? "today" : `${age}d old`}
          {age >= 10 && <span className="text-red-700"> · expires day 14</span>}
        </span>
        {m.crossService && <CrossBadge />}
      </div>
      <OfficerLine label="Mentor" o={m.mentor} />
      <OfficerLine label="Mentee" o={m.mentee} />
      {m.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-sm text-slate-700">
          {m.reasons.slice(0, 3).map((r) => <li key={r}>{r}</li>)}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={() => act(`/matches/${m.id}/approve`)}>Approve</Button>
        <Button variant="secondary" onClick={() => act(`/matches/${m.id}/reject`)}>Reject</Button>
        <Button variant="secondary" onClick={() => act(`/matches/${m.id}/defer`)}>Defer</Button>
        <Button variant="secondary" onClick={() => setShowAlts(!showAlts)}>{showAlts ? "Hide" : "Alternates"}</Button>
      </div>
      {showAlts && (
        <div className="space-y-3 border-t border-slate-200 pt-3">
          {(["mentor", "mentee"] as const).map((side) => (
            <div key={side}>
              <p className="mb-1 text-sm font-medium">Other {side}s for {who(side === "mentor" ? m.mentee : m.mentor)}</p>
              {m.alternates[side].length === 0 ? (
                <p className="text-sm text-slate-500">None available.</p>
              ) : (
                <ul className="space-y-2">
                  {m.alternates[side].map((a) => (
                    <li key={a.userId} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 p-2">
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">{who(a)} {a.crossService && <CrossBadge />}</p>
                        <p className="truncate text-slate-600">Score {a.score} · {a.unit}</p>
                      </div>
                      <Button
                        variant="ghost"
                        className="shrink-0 text-sm"
                        onClick={() => act(`/matches/${m.id}/reassign`, side === "mentor" ? { newMentorId: a.userId } : { newMenteeId: a.userId })}
                      >
                        Use
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

export default function MatchQueue({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"queue" | "active" | "manual">("queue");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [manual, setManual] = useState({ mentorId: "", menteeId: "" });

  const refresh = useCallback(async () => setData(await api<Overview>("GET", "/matching/overview")), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function act(path: string, body: unknown = {}) {
    setError("");
    setMessage("");
    try {
      await api("POST", `/matching${path}`, body);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.message.includes("confirm") && confirm("This match is active. End it and propose the new pairing?")) {
        return act(path, { ...(body as object), closeActive: true });
      }
      setError(e instanceof ApiError ? e.message : "Something went wrong");
    }
  }

  async function run() {
    setError("");
    try {
      const r = await api<{ proposed: number; crossService: number; expired: number }>("POST", "/matching/run", {});
      setMessage(`Proposed ${r.proposed} match${r.proposed === 1 ? "" : "es"}${r.crossService ? ` (${r.crossService} cross-service)` : ""}.${r.expired ? ` ${r.expired} stale proposal(s) expired.` : ""}`);
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Matching failed");
    }
  }

  async function saveManual() {
    await act("/manual", manual);
    setManual({ mentorId: "", menteeId: "" });
    setTab("queue");
  }

  if (!data) return <Screen title="Match queue"><p className="text-slate-600">Loading…</p></Screen>;

  return (
    <Screen
      title="Match queue"
      subtitle={`${data.unmatchedMentees.length} waiting for a mentor · ${data.openMentors.length} mentors with room`}
      action={<Button variant="ghost" onClick={onBack}>Done</Button>}
    >
      <div className="space-y-4 pb-8">
        <Button className="w-full" onClick={run}>Run matching</Button>
        {data.lastRunAt && <p className="text-xs text-slate-500">Last run {new Date(data.lastRunAt).toLocaleString()}</p>}
        {message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-900">{message}</p>}
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 text-sm">
          {([["queue", `Pending (${data.queue.length})`], ["active", `Active (${data.active.length})`], ["manual", "Manual"]] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`min-h-10 rounded-md ${tab === key ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "queue" &&
          (data.queue.length === 0 ? (
            <p className="text-slate-600">Nothing waiting. Run matching to propose new pairs.</p>
          ) : (
            <ul className="space-y-3">{data.queue.map((m) => <PendingCard key={m.id} m={m} act={act} />)}</ul>
          ))}

        {tab === "active" &&
          (data.active.length === 0 ? (
            <p className="text-slate-600">No active matches yet.</p>
          ) : (
            <ul className="space-y-3">
              {data.active.map((m) => (
                <li key={m.id} className="space-y-2 rounded-lg border border-slate-300 p-4">
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>Ends {m.endsOn ?? "—"}</span>
                    {m.crossService && <CrossBadge />}
                  </div>
                  <OfficerLine label="Mentor" o={m.mentor} />
                  <OfficerLine label="Mentee" o={m.mentee} />
                </li>
              ))}
            </ul>
          ))}

        {tab === "manual" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Pair two officers yourself. The same rules apply (grade gap, chain of command, PRD).</p>
            <select className={inputClass} value={manual.mentorId} onChange={(e) => setManual({ ...manual, mentorId: e.target.value })}>
              <option value="">Mentor…</option>
              {data.openMentors.map((o) => <option key={o.userId} value={o.userId}>{who(o)} · {svc(o.service)} · {o.unit}</option>)}
            </select>
            <select className={inputClass} value={manual.menteeId} onChange={(e) => setManual({ ...manual, menteeId: e.target.value })}>
              <option value="">Mentee…</option>
              {data.unmatchedMentees.map((o) => <option key={o.userId} value={o.userId}>{who(o)} · {svc(o.service)} · {o.unit}</option>)}
            </select>
            <Button className="w-full" disabled={!manual.mentorId || !manual.menteeId} onClick={saveManual}>Propose this match</Button>
          </div>
        )}
      </div>
    </Screen>
  );
}
