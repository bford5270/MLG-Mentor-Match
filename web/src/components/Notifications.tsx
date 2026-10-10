import { useEffect, useState } from "react";
import { enablePush, type PushState, pushState } from "../push";
import { Button } from "./ui";

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

export default function Notifications() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setState);
  }, []);

  if (!state || state === "on") return null;

  if (state === "needs-install") {
    return (
      <section className="rounded-lg border border-slate-300 p-4 text-sm text-slate-800">
        <h2 className="mb-1 font-semibold">Add this app to your Home Screen</h2>
        <p>
          In Safari, tap the Share button, then <strong>Add to Home Screen</strong>. Open it from there to turn on
          notifications for new messages and touch points.
        </p>
      </section>
    );
  }
  if (state === "unsupported") {
    return (
      <section className="rounded-lg border border-slate-300 p-4 text-sm text-slate-800">
        <h2 className="mb-1 font-semibold">Install the app</h2>
        <p>
          {isIOS() ? "Update iOS to 16.4 or later, then add this app to your Home Screen." : "Open your browser menu and choose Install app or Add to Home screen."}{" "}
          Until then you'll get an email when you have unread messages.
        </p>
      </section>
    );
  }
  if (state === "blocked") {
    return (
      <section className="rounded-lg border border-slate-300 p-4 text-sm text-slate-800">
        <h2 className="mb-1 font-semibold">Notifications are blocked</h2>
        <p>Allow notifications for this app in your phone's Settings to hear about new messages. You'll still get an email if messages go unread.</p>
      </section>
    );
  }
  if (state === "unavailable") return null;

  return (
    <section className="space-y-2 rounded-lg border border-slate-300 p-4 text-sm text-slate-800">
      <h2 className="font-semibold">Turn on notifications</h2>
      <p>Get a notification when your match messages you or a new touch point arrives. Notifications never show message text.</p>
      <Button
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setState(await enablePush());
          } finally {
            setBusy(false);
          }
        }}
      >
        Turn on notifications
      </Button>
    </section>
  );
}
