import { useEffect, useState } from "react";
import { api, type Me } from "../api";
import { Button, SafetyBanner, Screen } from "../components/ui";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

interface MyMatch {
  id: string;
  myRole: "mentor" | "mentee";
  endsOn: string | null;
  partner?: { name: string; service: string; grade: string; mosOrDesignator: string; unit: string; careerGoals: string[]; leadershipInterests: string[]; bio: string | null };
}

export default function Home({ me, onEditProfile, onAdmin, onQueue, onSignedOut }: { me: Me; onEditProfile: () => void; onAdmin: () => void; onQueue: () => void; onSignedOut: () => void }) {
  const [matches, setMatches] = useState<MyMatch[] | null>(null);
  useEffect(() => {
    api<{ matches: MyMatch[] }>("GET", "/me/matches").then((r) => setMatches(r.matches)).catch(() => setMatches([]));
  }, []);
  const asMentee = matches?.some((m) => m.myRole === "mentee");
  const stillWaiting = stillWantsMatch(me, matches);

  const p = me.profile!;
  const role = { mentee: "Looking for a mentor", mentor: "Mentoring", both: "Mentoring and looking for a mentor" }[p.mentorshipRole];

  async function signOut() {
    await api("POST", "/auth/logout", {});
    onSignedOut();
  }

  return (
    <Screen title={`${p.grade} ${p.name.split(",")[0]}`} subtitle={`${p.unit} · ${role}`}>
      <div className="space-y-4">
        {!isStandalone() && (
          <section className="rounded-lg border border-slate-300 p-4 text-sm text-slate-800">
            <h2 className="mb-1 font-semibold">Add this app to your Home Screen</h2>
            {isIOS() ? (
              <p>In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. Notifications only work once it's installed.</p>
            ) : (
              <p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
            )}
          </section>
        )}

        {matches?.map((m) => m.partner && (
          <section key={m.id} className="space-y-2 rounded-lg border border-red-900/30 bg-red-50/40 p-4">
            <p className="text-xs uppercase tracking-wide text-red-900">Your {m.myRole === "mentee" ? "mentor" : "mentee"}</p>
            <h2 className="text-lg font-semibold text-slate-900">{m.partner.grade} {m.partner.name}</h2>
            <p className="text-sm text-slate-700">{m.partner.service === "usn" ? "USN" : "USMC"} · {m.partner.mosOrDesignator} · {m.partner.unit}</p>
            {m.partner.careerGoals.length > 0 && <p className="text-sm text-slate-700"><span className="font-medium">Goals:</span> {m.partner.careerGoals.join(", ")}</p>}
            {m.partner.leadershipInterests.length > 0 && <p className="text-sm text-slate-700"><span className="font-medium">Wants to talk about:</span> {m.partner.leadershipInterests.join(", ")}</p>}
            {m.partner.bio && <p className="text-sm text-slate-700">{m.partner.bio}</p>}
            <p className="text-xs text-slate-500">In-app chat is coming in the next update.{m.endsOn ? ` Match runs until ${m.endsOn}.` : ""}</p>
          </section>
        ))}

        {stillWaiting && (
          <section className="rounded-lg bg-slate-50 p-4">
            <h2 className="font-semibold text-slate-900">You're on the list</h2>
            <p className="mt-1 text-sm text-slate-700">
              Matches are proposed in batches and approved by the G-10. You'll be notified when {asMentee || p.mentorshipRole === "mentor" ? "a mentee is assigned" : "you've been paired"}.
            </p>
          </section>
        )}

        <Button variant="secondary" className="w-full" onClick={onEditProfile}>Edit profile</Button>
        {(me.user.role === "approver" || me.user.role === "admin") && <Button variant="secondary" className="w-full" onClick={onQueue}>Match queue</Button>}
        {me.user.role === "admin" && <Button variant="secondary" className="w-full" onClick={onAdmin}>Admin</Button>}
        <Button variant="ghost" className="w-full" onClick={signOut}>Sign out</Button>
        <SafetyBanner />
      </div>
    </Screen>
  );
}

/** Show the "on the list" card while the officer still wants a pairing they don't have yet. */
function stillWantsMatch(me: Me, matches: MyMatch[] | null) {
  if (!matches || !me.profile) return false;
  const role = me.profile.mentorshipRole;
  const hasMentor = matches.some((m) => m.myRole === "mentee");
  const mentees = matches.filter((m) => m.myRole === "mentor").length;
  const wantsMentor = role !== "mentor" && !hasMentor;
  const wantsMentees = role !== "mentee" && mentees < me.profile.mentorCapacity;
  return wantsMentor || wantsMentees;
}
