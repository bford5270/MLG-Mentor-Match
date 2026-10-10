import { useEffect, useState } from "react";
import { api, ApiError, type Role } from "../api";
import { Button, Screen } from "../components/ui";

type UploadResult = { imported: number; deactivated: number; errors: { line: number; message: string }[] };
type UserRow = { id: string; email: string; role: Role; name: string | null; grade: string | null; unit: string | null; profileComplete: boolean };

export default function Admin({ selfId, onBack }: { selfId: string; onBack: () => void }) {
  const [csv, setCsv] = useState("");
  const [deactivateMissing, setDeactivateMissing] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState("");
  const [rosterCount, setRosterCount] = useState<number | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);

  async function refresh() {
    const [r, u] = await Promise.all([api("GET", "/admin/roster"), api("GET", "/admin/users")]);
    setRosterCount(r.roster.filter((x: { active: boolean }) => x.active).length);
    setUsers(u.users);
  }
  useEffect(() => {
    refresh();
  }, []);

  async function upload() {
    setError("");
    setResult(null);
    try {
      setResult(await api<UploadResult>("POST", "/admin/roster", { csv, deactivateMissing }));
      setCsv("");
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
    }
  }

  async function setRole(id: string, role: Role) {
    try {
      await api("POST", `/admin/users/${id}/role`, { role });
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change role");
    }
  }

  return (
    <Screen title="Admin" action={<Button variant="ghost" onClick={onBack}>Done</Button>}>
      <div className="space-y-6 pb-8">
        <section className="space-y-3">
          <h2 className="font-semibold text-slate-900">Officer roster {rosterCount !== null && <span className="font-normal text-slate-500">({rosterCount} active)</span>}</h2>
          <p className="text-sm text-slate-600">
            CSV with a header row: <code>email, name, service, grade, unit</code>. Service is USMC or USN; grade like O-3 or W-2.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            className="block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setCsv(await file.text());
            }}
          />
          <textarea
            className="block min-h-32 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
            placeholder="…or paste CSV here"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={deactivateMissing} onChange={(e) => setDeactivateMissing(e.target.checked)} />
            Deactivate officers not in this file (they can no longer sign in)
          </label>
          <Button className="w-full" disabled={!csv.trim()} onClick={upload}>Upload roster</Button>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {result && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p>Imported {result.imported}. Deactivated {result.deactivated}.</p>
              {result.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-red-800">
                  {result.errors.map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-900">Signed-up officers ({users.length})</h2>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-300">
            {users.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.name ? `${u.grade} ${u.name}` : u.email}</p>
                  <p className="truncate text-xs text-slate-500">{u.profileComplete ? u.unit : "Profile not finished"}</p>
                </div>
                <select
                  className="rounded-lg border border-slate-300 p-2 text-sm"
                  value={u.role}
                  disabled={u.id === selfId}
                  onChange={(e) => setRole(u.id, e.target.value as Role)}
                >
                  <option value="officer">Officer</option>
                  <option value="approver">Approver (G-10)</option>
                  <option value="admin">Admin</option>
                </select>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Screen>
  );
}
