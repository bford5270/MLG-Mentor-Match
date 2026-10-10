// One shared WebSocket for live updates, reconnecting with backoff. The
// socket only signals changes; screens refetch over REST when they reconnect.

export type LiveEvent =
  | { type: "message"; matchId: string; message: ChatMessage }
  | { type: "read"; matchId: string; userId: string; lastReadAt: string }
  | { type: "match_ended"; matchId: string }
  | { type: "reconnected" };

export interface ChatMessage {
  id: string;
  matchId: string;
  senderId: string | null;
  body: string;
  touchpointId: string | null;
  createdAt: string;
}

type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let attempts = 0;
let ping: ReturnType<typeof setInterval> | undefined;
let stopped = true;
let everConnected = false;

function connect() {
  if (stopped) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    attempts = 0;
    // Proxies drop idle sockets; keep it warm.
    ping = setInterval(() => socket?.readyState === WebSocket.OPEN && socket.send("ping"), 25_000);
    if (everConnected) listeners.forEach((l) => l({ type: "reconnected" }));
    everConnected = true;
  };
  socket.onmessage = (evt) => {
    if (evt.data === "pong") return;
    try {
      const event = JSON.parse(evt.data) as LiveEvent;
      listeners.forEach((l) => l(event));
    } catch {
      /* ignore */
    }
  };
  socket.onclose = (evt) => {
    clearInterval(ping);
    socket = null;
    if (stopped || evt.code === 4401) return;
    const delay = Math.min(30_000, 1000 * 2 ** attempts++);
    setTimeout(connect, delay);
  };
}

export function startLive() {
  if (!stopped) return;
  stopped = false;
  connect();
}

export function stopLive() {
  stopped = true;
  everConnected = false;
  socket?.close();
}

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Phones suspend sockets in the background; reconnect promptly on return.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !stopped && !socket) {
    attempts = 0;
    connect();
  }
});
