import { useEffect, useState } from "react";

// Mobile-only app: on a desktop-sized, non-touch screen show a "use your phone" page.
function useIsMobile() {
  const query = "(max-width: 820px), (pointer: coarse)";
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export default function App() {
  const isMobile = useIsMobile();

  if (!isMobile) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-8 text-center">
        <div className="max-w-sm space-y-3">
          <h1 className="text-2xl font-semibold text-slate-900">1st MLG Mentor Match</h1>
          <p className="text-slate-600">
            This app is built for phones. Open <strong>{window.location.host}</strong> on your personal phone and add it
            to your Home Screen.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-white px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="py-6">
        <h1 className="text-2xl font-semibold text-slate-900">1st MLG Mentor Match</h1>
        <p className="text-sm text-slate-600">Officer mentorship</p>
      </header>
      <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        Unclassified only. No CUI, no PII about others, no operational details.
      </section>
      <p className="mt-6 text-slate-600">Sign-in is coming in Phase 1.</p>
    </main>
  );
}
