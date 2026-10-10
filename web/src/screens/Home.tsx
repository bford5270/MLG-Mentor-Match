import { api, type Me } from "../api";
import { Button, SafetyBanner, Screen } from "../components/ui";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export default function Home({ me, onEditProfile, onAdmin, onSignedOut }: { me: Me; onEditProfile: () => void; onAdmin: () => void; onSignedOut: () => void }) {
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

        <section className="rounded-lg bg-slate-50 p-4">
          <h2 className="font-semibold text-slate-900">You're on the list</h2>
          <p className="mt-1 text-sm text-slate-700">
            Matches are proposed in batches and approved by the G-10. You'll be notified here when you've been paired.
          </p>
        </section>

        <Button variant="secondary" className="w-full" onClick={onEditProfile}>Edit profile</Button>
        {me.user.role === "admin" && <Button variant="secondary" className="w-full" onClick={onAdmin}>Admin</Button>}
        <Button variant="ghost" className="w-full" onClick={signOut}>Sign out</Button>
        <SafetyBanner />
      </div>
    </Screen>
  );
}
