import { useEffect, useState } from "react";
import { api } from "../api";
import { Button, inputClass } from "./ui";

interface Due {
  matchId: string;
  myRole: "mentor" | "mentee";
  partner: string;
}

function FeedbackForm({ due, onDone }: { due: Due; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [recommend, setRecommend] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("POST", `/me/matches/${due.matchId}/feedback`, { rating, wouldRecommend: recommend, comment: comment || undefined });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-300 p-4 text-sm">
      <h2 className="font-semibold text-slate-900">How did your mentorship with {due.partner} go?</h2>
      <div>
        <p className="mb-1 text-slate-700">How valuable was it?</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setRating(n)} aria-pressed={rating === n} className={`size-11 rounded-full border text-base ${rating >= n ? "border-red-900 bg-red-900 text-white" : "border-slate-300"}`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-slate-700">Would you recommend the program to another officer?</p>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((v) => (
            <button key={String(v)} onClick={() => setRecommend(v)} className={`min-h-11 rounded-lg border ${recommend === v ? "border-red-900 bg-red-900 text-white" : "border-slate-300"}`}>
              {v ? "Yes" : "No"}
            </button>
          ))}
        </div>
      </div>
      <textarea className={`${inputClass} min-h-20 py-2`} placeholder="Anything the G-10 should know? (optional, shared with the G-10)" maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button className="w-full" disabled={!rating || recommend === null || busy} onClick={submit}>Send feedback</Button>
    </section>
  );
}

export default function Feedback() {
  const [due, setDue] = useState<Due[]>([]);
  const load = () => api<{ due: Due[] }>("GET", "/me/feedback-due").then((r) => setDue(r.due)).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  return <>{due.map((d) => <FeedbackForm key={d.matchId} due={d} onDone={load} />)}</>;
}
