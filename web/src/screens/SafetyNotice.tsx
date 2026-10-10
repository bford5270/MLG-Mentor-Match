import { useState } from "react";
import { api } from "../api";
import { Button, Screen } from "../components/ui";

export default function SafetyNotice({ onDone }: { onDone: () => void }) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  async function acknowledge() {
    setBusy(true);
    try {
      await api("POST", "/me/acknowledge-safety", {});
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Before you start">
      <div className="space-y-4 text-slate-800">
        <p>This app runs on personal phones over the open internet. Everything you write in it must be:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Unclassified</strong>, and not CUI or FOUO.</li>
          <li><strong>Free of operational details</strong>: no movements, readiness, locations or schedules.</li>
          <li><strong>Free of other people's PII</strong>: no SSNs, medical details or personal information about Marines, Sailors or patients.</li>
        </ul>
        <p>
          Your conversations are private between you and your mentor or mentee. Administrators cannot read them. If
          something goes wrong, use <em>Report</em> in the app to reach the G-10.
        </p>
        <label className="flex items-start gap-3 rounded-lg border border-slate-300 p-3">
          <input type="checkbox" className="mt-1 size-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I understand and will follow these rules.</span>
        </label>
        <Button className="w-full" disabled={!checked || busy} onClick={acknowledge}>
          Continue
        </Button>
      </div>
    </Screen>
  );
}
