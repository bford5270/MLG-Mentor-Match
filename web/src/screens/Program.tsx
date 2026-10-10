import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Button, Field, inputClass, Screen } from "../components/ui";

interface Program {
  stats: Record<string, number>;
  touchpoints: { id: string; title: string; active: boolean; delivered: number; discussed: number }[];
  feedback: { count: number; averageRating: number | null; recommendPercent: number | null; comments: { rating: number; comment: string; createdAt: string }[] };
}
interface Touchpoint {
  id: string;
  sequence: number;
  offsetDays: number | null;
  daysBeforeEnd: number | null;
  title: string;
  body: string;
  questions: string[];
  active: boolean;
}

const when = (t: Touchpoint) =>
  t.offsetDays !== null ? (t.offsetDays === 0 ? "At approval" : `Day ${t.offsetDays}`) : `${t.daysBeforeEnd} days before the match ends`;

function TouchpointEditor({ tp, onSaved, onCancel }: { tp: Touchpoint; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({ title: tp.title, body: tp.body, questions: tp.questions.join("\n"), active: tp.active });
  const [error, setError] = useState("");
  async function save() {
    setError("");
    try {
      await api("PUT", `/matching/touchpoints/${tp.id}`, {
        title: draft.title,
        body: draft.body,
        questions: draft.questions.split("\n").map((q) => q.trim()).filter(Boolean),
        active: draft.active,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save");
    }
  }
  return (
    <div className="space-y-3 rounded-lg border border-red-900/40 p-4">
      <p className="text-xs text-slate-500">{when(tp)} · Changes apply to touch points not yet sent.</p>
      <Field label="Title"><input className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
      <Field label="Guidance"><textarea className={`${inputClass} min-h-28 py-2`} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
      <Field label="Questions (one per line)"><textarea className={`${inputClass} min-h-28 py-2`} value={draft.questions} onChange={(e) => setDraft({ ...draft, questions: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-5" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
        Send this touch point
      </label>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}

export default function ProgramScreen({ onBack }: { onBack: () => void }) {
  const [program, setProgram] = useState<Program | null>(null);
  const [tps, setTps] = useState<Touchpoint[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([api<Program>("GET", "/matching/program"), api<{ touchpoints: Touchpoint[] }>("GET", "/matching/touchpoints")]);
    setProgram(p);
    setTps(t.touchpoints);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!program) return <Screen title="Program"><p className="text-slate-600">Loading…</p></Screen>;
  const s = program.stats;
  const tiles: [string, number | string][] = [
    ["Active matches", s.active],
    ["Waiting approval", s.pending],
    ["Open reports", s.openReports],
    ["New officers (7d)", s.newOfficers],
    ["Avg rating", program.feedback.averageRating ?? "—"],
    ["Would recommend", program.feedback.recommendPercent !== null ? `${program.feedback.recommendPercent}%` : "—"],
  ];

  return (
    <Screen title="Program" subtitle="Counts and feedback only. Conversations stay private." action={<Button variant="ghost" onClick={onBack}>Done</Button>}>
      <div className="space-y-6 pb-8">
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-slate-50 p-3">
              <p className="text-2xl font-semibold text-slate-900">{value}</p>
              <p className="text-xs text-slate-600">{label}</p>
            </div>
          ))}
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Touch points</h2>
          <p className="text-sm text-slate-600">Sent automatically into each pair's chat. Tap one to edit it.</p>
          <ul className="space-y-2">
            {tps.map((tp) => {
              const stat = program.touchpoints.find((x) => x.id === tp.id);
              return editing === tp.id ? (
                <li key={tp.id}>
                  <TouchpointEditor tp={tp} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setMessage("Saved."); load(); }} />
                </li>
              ) : (
                <li key={tp.id}>
                  <button className={`w-full rounded-lg border border-slate-300 p-3 text-left ${tp.active ? "" : "opacity-60"}`} onClick={() => setEditing(tp.id)}>
                    <p className="font-medium text-slate-900">{tp.title}{!tp.active && " (off)"}</p>
                    <p className="text-xs text-slate-600">{when(tp)} · sent {stat?.delivered ?? 0} · discussed {stat?.discussed ?? 0}</p>
                  </button>
                </li>
              );
            })}
          </ul>
          {message && <p className="text-sm text-green-800">{message}</p>}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Feedback ({program.feedback.count})</h2>
          {program.feedback.comments.length === 0 ? (
            <p className="text-sm text-slate-600">No comments yet. Officers are asked for feedback when a match ends.</p>
          ) : (
            <ul className="space-y-2">
              {program.feedback.comments.map((f, i) => (
                <li key={i} className="rounded-lg bg-slate-50 p-3 text-sm">
                  <p className="text-xs text-slate-500">{"★".repeat(f.rating)} · {new Date(f.createdAt).toLocaleDateString()}</p>
                  <p className="whitespace-pre-wrap">{f.comment}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Weekly summary email</h2>
          <p className="text-sm text-slate-600">Sent to approvers and admins every Monday morning.</p>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              const r = await api<{ sent: number }>("POST", "/matching/digest/send", {});
              setMessage(`Summary sent to ${r.sent} recipient(s).`);
            }}
          >
            Send it now
          </Button>
        </section>
      </div>
    </Screen>
  );
}
