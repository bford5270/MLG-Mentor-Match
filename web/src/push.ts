import { api } from "./api";

export type PushState = "unsupported" | "needs-install" | "off" | "on" | "blocked" | "unavailable";

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  // iOS only exposes web push to apps added to the Home Screen.
  if (isIOS() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  const { publicKey } = await api<{ publicKey: string | null }>("GET", "/push/key");
  if (!publicKey) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  const json = sub.toJSON();
  await api("POST", "/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
  return "on";
}

/** Re-sends the current subscription after sign-in, so a shared device follows its current user. */
export async function syncPush() {
  if ((await pushState()) !== "on") return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    const json = sub.toJSON();
    await api("POST", "/push/subscribe", { endpoint: json.endpoint, keys: json.keys }).catch(() => {});
  }
}

export async function disablePushForSignOut() {
  const reg = await navigator.serviceWorker?.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await api("POST", "/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
}
