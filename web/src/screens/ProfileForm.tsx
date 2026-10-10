import { type FormEvent, useEffect, useState } from "react";
import { api, ApiError, type Me, type Options, type Profile } from "../api";
import { Button, Chips, Field, inputClass, SafetyBanner, Screen } from "../components/ui";

type Person = { id: string; name: string; grade: string; unit?: string | null };

function RosterPicker({ label, value, initial, onChange }: { label: string; value: string | null; initial?: Person; onChange: (id: string | null) => void }) {
  const [selected, setSelected] = useState<Person | undefined>(initial);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Person[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) return setResults([]);
    const t = setTimeout(() => {
      api<{ results: Person[] }>("GET", `/roster/search?q=${encodeURIComponent(q)}`)
        .then((r) => setResults(r.results))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value && selected) {
    return (
      <Field label={label} group>
        <div className="flex items-center justify-between rounded-lg border border-slate-300 px-3 py-2">
          <span>{selected.grade} {selected.name}</span>
          <Button type="button" variant="ghost" onClick={() => { onChange(null); setSelected(undefined); }}>Change</Button>
        </div>
      </Field>
    );
  }
  return (
    <Field label={label} group hint="Optional. Used only to keep you from being matched inside your own chain.">
      <input className={inputClass} placeholder="Search by last name" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="mt-1 divide-y divide-slate-200 rounded-lg border border-slate-300">
          {results.map((p) => (
            <li key={p.id}>
              <button type="button" className="w-full px-3 py-3 text-left" onClick={() => { setSelected(p); onChange(p.id); setQ(""); setResults([]); }}>
                {p.grade} {p.name} {p.unit && <span className="text-sm text-slate-500">· {p.unit}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

function initialProfile(me: Me): Profile {
  return (
    me.profile ?? {
      name: me.roster?.name ?? "",
      service: me.roster?.service ?? "usmc",
      grade: me.roster?.grade ?? "",
      mosOrDesignator: "",
      unit: "",
      section: "",
      reportingSeniorRosterId: null,
      reviewingOfficerRosterId: null,
      prd: "",
      commissioningSource: null,
      mentorshipRole: "mentee",
      mentorCapacity: 1,
      careerGoals: [],
      leadershipInterests: [],
      personalFactors: [],
      bio: "",
    }
  );
}

export default function ProfileForm({ me, onSaved, onCancel }: { me: Me; onSaved: () => void; onCancel?: () => void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [p, setP] = useState<Profile>(() => initialProfile(me));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Options>("GET", "/options").then(setOptions);
  }, []);

  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setP((prev) => ({ ...prev, [key]: value }));
  const err = (key: string) => errors[key]?.[0];
  const person = (id: string | null) => me.people.find((x) => x.id === id);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setErrors({});
    try {
      await api("PUT", "/me/profile", p);
      onSaved();
    } catch (ex) {
      if (ex instanceof ApiError) {
        setError(ex.message);
        setErrors(ex.fields ?? {});
      } else setError("Couldn't reach the server");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setBusy(false);
    }
  }

  if (!options) return <Screen title="Your profile"><p className="text-slate-600">Loading…</p></Screen>;

  const isMentor = p.mentorshipRole !== "mentee";

  return (
    <Screen
      title="Your profile"
      subtitle="Used only for matching. Your match sees your name, grade, unit, goals and bio."
      action={onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}
    >
      <form onSubmit={save} className="space-y-5 pb-8">
        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}

        <Field label="I want to" group error={err("mentorshipRole")}>
          <div className="grid grid-cols-3 gap-2">
            {options.mentorshipRoles.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => set("mentorshipRole", r.value as Profile["mentorshipRole"])}
                className={`min-h-12 rounded-lg border text-sm ${p.mentorshipRole === r.value ? "border-red-900 bg-red-900 text-white" : "border-slate-300"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </Field>

        {isMentor && (
          <Field label="Mentees I can take on" error={err("mentorCapacity")}>
            <select className={inputClass} value={p.mentorCapacity} onChange={(e) => set("mentorCapacity", Number(e.target.value))}>
              {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
        )}

        <Field label="Name (Last, First)" error={err("name")}>
          <input className={inputClass} value={p.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Service" error={err("service")}>
            <select className={inputClass} value={p.service} onChange={(e) => set("service", e.target.value as Profile["service"])}>
              {options.services.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Grade" error={err("grade")}>
            <select className={inputClass} value={p.grade} onChange={(e) => set("grade", e.target.value)} required>
              <option value="">Select</option>
              {options.grades.map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
        </div>

        <Field label={p.service === "usn" ? "Designator" : "MOS"} error={err("mosOrDesignator")} hint={p.service === "usn" ? "e.g. 2100, 2900, 2300" : "e.g. 0402, 3002, 1302"}>
          <input className={inputClass} value={p.mosOrDesignator} onChange={(e) => set("mosOrDesignator", e.target.value)} required />
        </Field>

        <Field label="Unit" error={err("unit")}>
          <select className={inputClass} value={p.unit} onChange={(e) => set("unit", e.target.value)} required>
            <option value="">Select</option>
            {options.units.map((u) => <option key={u}>{u}</option>)}
          </select>
        </Field>

        <Field label="Section / company" error={err("section")} hint="e.g. S-4, Alpha Co, Surgical Co">
          <input className={inputClass} value={p.section ?? ""} onChange={(e) => set("section", e.target.value)} />
        </Field>

        <RosterPicker label="Reporting senior" value={p.reportingSeniorRosterId} initial={person(p.reportingSeniorRosterId)} onChange={(id) => set("reportingSeniorRosterId", id)} />
        <RosterPicker label="Reviewing officer" value={p.reviewingOfficerRosterId} initial={person(p.reviewingOfficerRosterId)} onChange={(id) => set("reviewingOfficerRosterId", id)} />

        <Field label="PRD (or EAS, if sooner)" error={err("prd")} hint="Matches are only made when both officers have 6+ months left.">
          <input className={inputClass} type="date" value={p.prd} onChange={(e) => set("prd", e.target.value)} required />
        </Field>

        <Field label="Commissioning source" error={err("commissioningSource")}>
          <select className={inputClass} value={p.commissioningSource ?? ""} onChange={(e) => set("commissioningSource", e.target.value || null)}>
            <option value="">Prefer not to say</option>
            {options.commissioningSources.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>

        <Field label={isMentor && p.mentorshipRole === "mentor" ? "Career areas I can advise on" : "Career goals"} error={err("careerGoals")} group>
          <Chips options={options.careerGoals} value={p.careerGoals} onChange={(v) => set("careerGoals", v)} />
        </Field>

        <Field label="Leadership topics I want to talk about" group error={err("leadershipInterests")}>
          <Chips options={options.leadershipInterests} value={p.leadershipInterests} onChange={(v) => set("leadershipInterests", v)} />
        </Field>

        <Field label="About me (optional)" group error={err("personalFactors")} hint="Helps find someone who's been where you are.">
          <Chips options={options.personalFactors} value={p.personalFactors} onChange={(v) => set("personalFactors", v)} />
        </Field>

        <Field label="Short bio (optional)" error={err("bio")}>
          <textarea className={`${inputClass} min-h-24 py-2`} maxLength={1000} value={p.bio ?? ""} onChange={(e) => set("bio", e.target.value)} />
        </Field>

        <SafetyBanner />
        <Button className="w-full" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button>
      </form>
    </Screen>
  );
}
