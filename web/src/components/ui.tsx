import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-red-900 text-white active:bg-red-950 disabled:bg-slate-300",
    secondary: "border border-slate-300 bg-white text-slate-900 active:bg-slate-100",
    ghost: "text-red-900 active:bg-red-50",
  }[variant];
  return (
    <button
      className={`min-h-12 rounded-lg px-4 text-base font-medium disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

/**
 * Pass `group` when the children are buttons rather than one input: a <label>
 * forwards taps to its first control, which misfires when buttons re-render.
 */
export function Field({ label, error, hint, group, children }: { label: string; error?: string; hint?: string; group?: boolean; children: ReactNode }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag className="block space-y-1" {...(group ? { role: "group", "aria-label": label } : {})}>
      <span className="block text-sm font-medium text-slate-800">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-500">{hint}</span>}
      {error && <span className="block text-xs text-red-700">{error}</span>}
    </Tag>
  );
}

export const inputClass =
  "block w-full min-h-12 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-red-900 focus:outline-none";

export function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== opt) : [...value, opt])}
            className={`rounded-full border px-3 py-2 text-sm ${on ? "border-red-900 bg-red-900 text-white" : "border-slate-300 bg-white text-slate-800"}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

export function Screen({ title, subtitle, children, action }: { title: string; subtitle?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col bg-white px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-start justify-between gap-2 py-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-600">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

export function SafetyBanner() {
  return (
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      Unclassified only. No CUI, no PII about others, no operational details.
    </div>
  );
}
