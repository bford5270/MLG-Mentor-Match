import { type FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { Button, inputClass } from "../components/ui";
import { type ChatMessage, subscribe } from "../live";

interface Partner {
  name: string;
  grade: string;
}

interface Thread {
  match: { id: string; status: string; myRole: "mentor" | "mentee" };
  messages: ChatMessage[];
  hasMore: boolean;
  partnerLastReadAt: string | null;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

function ReportSheet({ matchId, messages, myId, onClose }: { matchId: string; messages: ChatMessage[]; myId: string; onClose: (sent: boolean) => void }) {
  const [description, setDescription] = useState("");
  const [attach, setAttach] = useState<string[]>([]);
  const [error, setError] = useState("");
  const recent = messages.filter((m) => m.senderId !== null).slice(-15).reverse();

  async function submit() {
    setError("");
    try {
      await api("POST", `/chat/${matchId}/report`, { description, attachMessageIds: attach });
      onClose(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't send the report");
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]">
      <div className="flex items-center justify-between py-2">
        <h2 className="text-xl font-semibold">Report a concern</h2>
        <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto pb-4">
        <p className="text-sm text-slate-700">
          This goes to the G-10. They <strong>cannot</strong> read your conversation. They'll see only what you write
          here and any messages you choose to include below.
        </p>
        <textarea
          className={`${inputClass} min-h-28 py-2`}
          placeholder="What happened?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
        {recent.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Include messages (optional)</p>
            {recent.map((m) => (
              <label key={m.id} className="flex items-start gap-3 rounded-lg border border-slate-200 p-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={attach.includes(m.id)}
                  onChange={(e) => setAttach(e.target.checked ? [...attach, m.id] : attach.filter((x) => x !== m.id))}
                />
                <span>
                  <span className="text-xs text-slate-500">{m.senderId === myId ? "You" : "Them"} · {day(m.createdAt)} {time(m.createdAt)}</span>
                  <span className="block whitespace-pre-wrap">{m.body}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>
      <Button disabled={description.trim().length < 10} onClick={submit}>Send report</Button>
    </div>
  );
}

export default function Chat({ matchId, myId, partner, onBack }: { matchId: string; myId: string; partner: Partner; onBack: () => void }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(() => {
    if (document.visibilityState === "visible") api("POST", `/chat/${matchId}/read`, {}).catch(() => {});
  }, [matchId]);

  const load = useCallback(async () => {
    try {
      setThread(await api<Thread>("GET", `/chat/${matchId}/messages`));
      markRead();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load messages");
    }
  }, [matchId, markRead]);

  useEffect(() => {
    load();
    const unsub = subscribe((e) => {
      if (e.type === "reconnected") return load();
      if (!("matchId" in e) || e.matchId !== matchId) return;
      if (e.type === "message") {
        setThread((t) => (t && !t.messages.some((m) => m.id === e.message.id) ? { ...t, messages: [...t.messages, e.message] } : t));
        if (e.message.senderId !== myId) markRead();
      } else if (e.type === "read" && e.userId !== myId) {
        setThread((t) => (t ? { ...t, partnerLastReadAt: e.lastReadAt } : t));
      } else if (e.type === "match_ended") {
        setThread((t) => (t ? { ...t, match: { ...t.match, status: "ended" } } : t));
      }
    });
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, matchId, myId, markRead]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread?.messages.length]);

  async function loadEarlier() {
    if (!thread?.messages.length) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    stickToBottom.current = false;
    const older = await api<Thread>("GET", `/chat/${matchId}/messages?before=${encodeURIComponent(thread.messages[0].createdAt)}`);
    setThread((t) => (t ? { ...t, messages: [...older.messages, ...t.messages], hasMore: older.hasMore } : t));
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError("");
    stickToBottom.current = true;
    try {
      const { message } = await api<{ message: ChatMessage }>("POST", `/chat/${matchId}/messages`, { body });
      setThread((t) => (t && !t.messages.some((m) => m.id === message.id) ? { ...t, messages: [...t.messages, message] } : t));
      setDraft("");
    } catch (ex) {
      setError(ex instanceof ApiError ? ex.message : "Not sent. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  async function endMatch() {
    setMenu(false);
    const reason = prompt("End this mentorship? You won't be matched with this officer again.\n\nOptional: a reason for the G-10 (your match won't see it).");
    if (reason === null) return;
    try {
      await api("POST", `/chat/${matchId}/end`, { reason: reason || undefined });
      onBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't end the match");
    }
  }

  const ended = thread?.match.status !== undefined && thread.match.status !== "active";
  const lastMine = thread?.messages.filter((m) => m.senderId === myId).at(-1);
  const seen = lastMine && thread?.partnerLastReadAt && thread.partnerLastReadAt >= lastMine.createdAt;

  return (
    <main className="mx-auto flex h-dvh max-w-md flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-slate-200 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2">
        <Button variant="ghost" onClick={onBack} aria-label="Back">‹ Back</Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{partner.grade} {partner.name}</p>
          <p className="text-xs text-slate-500">Your {thread?.match.myRole === "mentee" ? "mentor" : "mentee"}</p>
        </div>
        <div className="relative">
          <Button variant="ghost" aria-label="More" onClick={() => setMenu(!menu)}>•••</Button>
          {menu && (
            <div className="absolute right-0 z-10 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <button className="block w-full px-4 py-3 text-left" onClick={() => { setMenu(false); setReporting(true); }}>Report a concern</button>
              {!ended && <button className="block w-full px-4 py-3 text-left text-red-800" onClick={endMatch}>End mentorship</button>}
            </div>
          )}
        </div>
      </header>

      <p className="bg-amber-50 px-4 py-1.5 text-center text-xs text-amber-900">Unclassified only · No CUI · No PII about others · No operational details</p>

      <div
        ref={listRef}
        className="flex-1 space-y-2 overflow-y-auto px-3 py-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {thread?.hasMore && (
          <div className="text-center">
            <Button variant="ghost" className="text-sm" onClick={loadEarlier}>Load earlier messages</Button>
          </div>
        )}
        {thread && thread.messages.length === 0 && (
          <p className="px-4 pt-8 text-center text-sm text-slate-500">
            Say hello and set up a first conversation. A call or coffee in the first two weeks works well.
          </p>
        )}
        {thread?.messages.map((m, i) => {
          const showDay = i === 0 || day(thread.messages[i - 1].createdAt) !== day(m.createdAt);
          const mine = m.senderId === myId;
          return (
            <div key={m.id}>
              {showDay && <p className="py-2 text-center text-xs text-slate-500">{day(m.createdAt)}</p>}
              {m.senderId === null ? (
                <div className="mx-2 whitespace-pre-wrap rounded-lg border border-red-900/20 bg-red-50/50 p-3 text-sm text-slate-800">{m.body}</div>
              ) : (
                <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 ${mine ? "rounded-br-sm bg-red-900 text-white" : "rounded-bl-sm bg-slate-100 text-slate-900"}`}>
                    {m.body}
                    <span className={`mt-0.5 block text-right text-[10px] ${mine ? "text-red-100" : "text-slate-500"}`}>{time(m.createdAt)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {seen && <p className="pr-1 text-right text-[11px] text-slate-500">Seen</p>}
      </div>

      {notice && <p className="bg-green-50 px-4 py-2 text-sm text-green-900">{notice}</p>}
      {error && <p className="bg-red-50 px-4 py-2 text-sm text-red-800">{error}</p>}

      {ended ? (
        <p className="border-t border-slate-200 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-center text-sm text-slate-600">This mentorship has ended.</p>
      ) : (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          <textarea
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-slate-300 px-3 py-2.5 text-base focus:border-red-900 focus:outline-none"
            rows={1}
            placeholder="Message"
            value={draft}
            maxLength={2000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button className="min-h-11 rounded-full" disabled={sending || !draft.trim()}>Send</Button>
        </form>
      )}

      {reporting && thread && (
        <ReportSheet
          matchId={matchId}
          myId={myId}
          messages={thread.messages}
          onClose={(sent) => {
            setReporting(false);
            if (sent) setNotice("Report sent to the G-10.");
          }}
        />
      )}
    </main>
  );
}
