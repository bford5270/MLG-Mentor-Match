import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Me } from "./api";
import Admin from "./screens/Admin";
import Chat from "./screens/Chat";
import Home, { type MyMatch } from "./screens/Home";
import { startLive, stopLive } from "./live";
import MatchQueue from "./screens/MatchQueue";
import ProfileForm from "./screens/ProfileForm";
import SafetyNotice from "./screens/SafetyNotice";
import SignIn from "./screens/SignIn";

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
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [view, setView] = useState<"home" | "profile" | "admin" | "queue" | "chat">("home");
  const [chatWith, setChatWith] = useState<MyMatch | null>(null);

  const load = useCallback(async () => {
    try {
      setMe(await api<Me>("GET", "/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const signedIn = Boolean(me);
  useEffect(() => {
    if (signedIn) startLive();
    else stopLive();
  }, [signedIn]);

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

  if (me === undefined) return <main className="min-h-dvh bg-white" />;
  if (me === null) return <SignIn onSignedIn={load} />;
  if (!me.user.safetyAcknowledged) return <SafetyNotice onDone={load} />;
  if (!me.profile) return <ProfileForm me={me} onSaved={load} />;
  if (view === "profile")
    return <ProfileForm me={me} onSaved={() => load().then(() => setView("home"))} onCancel={() => setView("home")} />;
  if (view === "admin" && me.user.role === "admin") return <Admin selfId={me.user.id} onBack={() => setView("home")} />;
  if (view === "chat" && chatWith?.partner)
    return <Chat matchId={chatWith.id} myId={me.user.id} partner={chatWith.partner} onBack={() => setView("home")} />;
  if (view === "queue" && (me.user.role === "approver" || me.user.role === "admin")) return <MatchQueue onBack={() => setView("home")} />;
  return (
    <Home
      me={me}
      onEditProfile={() => setView("profile")}
      onAdmin={() => setView("admin")}
      onQueue={() => setView("queue")}
      onOpenChat={(m) => {
        setChatWith(m);
        setView("chat");
      }}
      onSignedOut={() => setMe(null)}
    />
  );
}
