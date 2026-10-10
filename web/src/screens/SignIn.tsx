import { type FormEvent, useState } from "react";
import { api, ApiError } from "../api";
import { Button, Field, inputClass, Screen } from "../components/ui";

export default function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/auth/request-code", { email });
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("POST", "/auth/verify", { email, code });
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="1st MLG Mentor Match" subtitle="Officer mentorship">
      {step === "email" ? (
        <form onSubmit={requestCode} className="space-y-4">
          <p className="text-slate-700">Sign in with the email address your unit has on file for you.</p>
          <Field label="Email" error={error}>
            <input
              className={inputClass}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Button className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-4">
          <p className="text-slate-700">
            If <strong>{email}</strong> is on the 1st MLG officer roster, a 6-digit code is on its way. It expires in 10
            minutes. Check spam/junk if it doesn't arrive.
          </p>
          <Field label="Sign-in code" error={error}>
            <input
              className={`${inputClass} tracking-[0.5em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button className="w-full" disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Sign in"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => { setStep("email"); setCode(""); setError(""); }}>
            Use a different email
          </Button>
        </form>
      )}
    </Screen>
  );
}
