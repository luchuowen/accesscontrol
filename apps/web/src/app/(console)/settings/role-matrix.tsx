'use client';
import { Check, Lock, RotateCcw, ShieldCheck } from 'lucide-react';
import { useState, useTransition } from 'react';
import { resetRole, toggleRolePerm } from './team-actions';

/**
 * What each role can do, editable by the owner (3 Oct 2026). Each club can give a role more rights or take some away;
 * changed cells are marked and each role can go back to the defaults. Owner rights, closing the club and door setup
 * never change.
 */
export function RoleMatrix({
  roles,
  perms,
  have,
  base,
  editable,
}: {
  roles: { key: string; label: string }[];
  perms: { key: string; label: string }[];
  have: Record<string, string[]>;
  base: Record<string, string[]>;
  editable: boolean;
}) {
  const [cur, setCur] = useState(have);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = (r: string, p: string) => (cur[r] ?? []).includes(p);
  const changed = (r: string) => {
    const a = new Set(cur[r] ?? []);
    const b = new Set(base[r] ?? []);
    return perms.some((p) => a.has(p.key) !== b.has(p.key));
  };
  const flip = (r: string, p: string) => {
    const next = !on(r, p);
    setCur((c) => ({ ...c, [r]: next ? [...(c[r] ?? []), p] : (c[r] ?? []).filter((x) => x !== p) }));
    setErr(null);
    start(async () => {
      const res = await toggleRolePerm(r, p, next);
      if (res.error) {
        setErr(res.error);
        setCur((c) => ({ ...c, [r]: !next ? [...(c[r] ?? []), p] : (c[r] ?? []).filter((x) => x !== p) }));
      }
    });
  };
  const reset = (r: string) => {
    setCur((c) => ({ ...c, [r]: base[r] ?? [] }));
    start(async () => {
      const res = await resetRole(r);
      if (res.error) setErr(res.error);
    });
  };
  return (
    <section className="rounded-2xl border border-[#E7EBF3] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={16} className="text-emerald-600" />
        <h3 className="font-semibold">Roles & permissions</h3>
        <span className="ml-auto text-[12px] text-ink-500">
          {editable
            ? pending
              ? 'Saving…'
              : 'Click a dot to give or remove a right'
            : 'Only the owner can change this'}
        </span>
      </div>
      {err && <p className="mt-2 text-[12.5px] text-rose-700">{err}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead>
            <tr className="text-ink-500">
              <th className="py-2 pr-2 text-left font-medium" />
              <th className="px-1 py-2 font-medium">Owner</th>
              {roles.map((r) => (
                <th key={r.key} className="px-1 py-2 font-medium">
                  <span className="block">{r.label}</span>
                  {editable && changed(r.key) && (
                    <button
                      type="button"
                      onClick={() => reset(r.key)}
                      className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:underline"
                    >
                      <RotateCcw size={11} /> Reset
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {perms.map((p) => {
              const fixed = p.key === 'club.own';
              return (
                <tr key={p.key} className="border-t border-[#F0F2F6]">
                  <td className="py-2.5 pr-3 text-ink-700">
                    {p.label}
                    {fixed && <Lock size={11} className="ml-1.5 inline text-ink-300" />}
                  </td>
                  <td className="px-1 text-center">
                    <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white">
                      <Check size={13} strokeWidth={3} />
                    </span>
                  </td>
                  {roles.map((r) => {
                    const yes = on(r.key, p.key);
                    const def = (base[r.key] ?? []).includes(p.key);
                    const diff = yes !== def;
                    const cls = `inline-grid h-6 w-6 place-items-center rounded-full transition ${yes ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-transparent'} ${diff ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`;
                    return (
                      <td key={r.key} className="px-1 text-center">
                        {editable && !fixed ? (
                          <button
                            type="button"
                            onClick={() => flip(r.key, p.key)}
                            aria-pressed={yes}
                            aria-label={`${r.label}: ${p.label}`}
                            title={diff ? 'Changed from the default' : undefined}
                            className={`${cls} hover:scale-110 ${yes ? '' : 'hover:bg-slate-200'}`}
                          >
                            <Check size={13} strokeWidth={3} />
                          </button>
                        ) : (
                          <span className={cls}>
                            <Check size={13} strokeWidth={3} />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-500">
        <span className="inline-flex items-center gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-slate-100 ring-2 ring-amber-400" /> Changed for this club
        </span>
        <span>Changes apply the next time each person opens a page. Front desk sees today’s figures only.</span>
      </p>
    </section>
  );
}
