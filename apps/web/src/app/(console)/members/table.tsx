'use client';
import { ChevronRight, CreditCard, Loader2, MessageSquare, Smartphone, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type MemberPreview, memberPreview } from './preview';

/** Members table + side drawer (design A). Rows come from the server already filtered. */
export type Row = {
  id: string;
  no: number;
  name: string;
  phone: string | null;
  services: { name: string; ends: string }[];
  status: 'active' | 'ending' | 'lapsed' | 'never' | 'inactive';
  lastVisit: string | null;
  card: boolean;
  sync: 'synced' | 'pending' | 'failed';
};

const TZ = 'Africa/Nairobi';
const DAY = 86400_000;
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const hm = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const short = (d: Date) =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    timeZone: TZ,
  });
function endLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d < now) return { text: `ended ${short(d)}`, tone: 'rose' as const };
  const today = dayKey(d) === dayKey(now);
  const soon = d.getTime() - now.getTime() <= 7 * DAY;
  return {
    text: today ? `${d.getHours() >= 18 ? 'Tonight' : 'Today'} ${hm(d)}` : short(d),
    tone: soon ? ('amber' as const) : ('plain' as const),
  };
}
function visit(iso: string | null) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return `Today ${hm(d)}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - DAY))) return `Yesterday ${hm(d)}`;
  const days = Math.floor((now.getTime() - d.getTime()) / DAY);
  return days < 60 ? `${days} days ago` : short(d);
}
export const phoneLabel = (p: string | null) => {
  if (!p) return '—';
  const d = p.replace(/\D/g, '');
  const m = d.match(/^254(\d{3})(\d{3})(\d{3})$/);
  return m ? `+254 ${m[1]} ${m[2]} ${m[3]}` : p;
};
const initials = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
const AV = [
  'bg-indigo-50 text-indigo-700',
  'bg-orange-50 text-orange-700',
  'bg-violet-50 text-violet-700',
  'bg-sky-50 text-sky-700',
  'bg-rose-50 text-rose-700',
  'bg-emerald-50 text-emerald-700',
];
export const STATUS: Record<Row['status'], { label: string; cls: string; dot: string }> = {
  active: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  ending: { label: 'Ending soon', cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  lapsed: { label: 'Lapsed', cls: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' },
  never: { label: 'Never paid', cls: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  inactive: { label: 'Inactive', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-300' },
};
const SYNC = {
  synced: { label: 'Synced', dot: 'bg-emerald-500' },
  pending: { label: 'Pending', dot: 'bg-amber-500' },
  failed: { label: 'Failed', dot: 'bg-rose-500' },
};
const chip = {
  rose: 'border-rose-200 bg-rose-50 text-rose-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  plain: 'border-[#E5E8EE] bg-white text-ink-700',
};

export function MembersTable({ rows, canPay }: { rows: Row[]; canPay: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="text-left">
            <tr className="border-b border-[#EEF1F6]">
              {['Member', 'Phone', 'Services', 'Status', 'Last visit', 'Door'].map((h) => (
                <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EEF1F6]">
            {rows.map((r, i) => {
              const st = STATUS[r.status];
              return (
                <tr
                  key={r.id}
                  onClick={() => setOpen(r.id)}
                  className={`cursor-pointer transition hover:bg-slate-50 ${open === r.id ? 'bg-emerald-50/40 shadow-[inset_3px_0_0_#047857]' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold ${AV[i % AV.length]}`}
                      >
                        {initials(r.name)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(r.id);
                        }}
                        className="min-w-0 text-left"
                      >
                        <b className="block truncate font-semibold text-ink-900">{r.name}</b>
                        <span className="font-mono text-[11.5px] text-slate-400">#{r.no}</span>
                      </button>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-ink-500">{phoneLabel(r.phone)}</td>
                  <td className="px-4 py-3">
                    {r.services.length === 0 ? (
                      <span className="text-ink-500">None yet</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(r.services.some((x) => new Date(x.ends).getTime() > Date.now())
                          ? r.services.filter((x) => new Date(x.ends).getTime() > Date.now())
                          : r.services.slice(0, 1)
                        )
                          .slice(0, 3)
                          .map((x) => {
                            const e = endLabel(x.ends);
                            return (
                              <span
                                key={x.name}
                                className={`whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11.5px] ${chip[e.tone]}`}
                              >
                                {x.name} <span className="font-semibold">{e.text}</span>
                              </span>
                            );
                          })}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${st.cls}`}
                    >
                      <i className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-700">{visit(r.lastVisit)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink-500">
                    <span className="inline-flex items-center gap-1.5">
                      <i className={`h-2 w-2 rounded-full ${SYNC[r.sync].dot}`} />
                      {SYNC[r.sync].label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {open && <Drawer id={open} canPay={canPay} onClose={() => setOpen(null)} />}
    </>
  );
}

function Drawer({ id, canPay, onClose }: { id: string; canPay: boolean; onClose: () => void }) {
  const [m, setM] = useState<MemberPreview | null | undefined>(undefined);
  useEffect(() => {
    setM(undefined);
    memberPreview(id).then(setM);
  }, [id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const now = Date.now();
  const running = m?.services.filter((x) => new Date(x.ends).getTime() > now) ?? [];
  const status: Row['status'] = !m
    ? 'never'
    : running.some((x) => new Date(x.ends).getTime() - now <= 7 * DAY)
      ? 'ending'
      : running.length
        ? 'active'
        : m.services.length
          ? 'lapsed'
          : 'never';
  const act =
    'flex flex-col items-center gap-1 rounded-xl border border-[#E5E8EE] px-2 py-2.5 text-[12px] font-semibold text-ink-900 hover:bg-slate-50';
  return (
    <>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-[#0B1629]/30 lg:bg-transparent"
      />
      <aside
        role="dialog"
        aria-label="Member"
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col overflow-y-auto border-l border-[#E7EBF3] bg-white p-5 shadow-[-24px_0_48px_-24px_rgba(11,22,41,0.25)] motion-safe:animate-[pop_.2s_ease-out]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
        >
          <X size={18} />
        </button>
        {m === undefined ? (
          <div className="grid flex-1 place-items-center text-ink-500">
            <Loader2 className="animate-spin" />
          </div>
        ) : m === null ? (
          <p className="text-sm text-ink-500">This member could not be found.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 pr-10">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-orange-50 text-[15px] font-bold text-orange-700">
                {initials(m.name)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[17px] font-semibold">{m.name}</h2>
                <div className="text-[12.5px] text-ink-500">
                  #{m.no}
                  {m.phone ? ` · ${phoneLabel(m.phone)}` : ''}
                </div>
                <span
                  className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[status].cls}`}
                >
                  <i className={`h-1.5 w-1.5 rounded-full ${STATUS[status].dot}`} />
                  {STATUS[status].label}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-[linear-gradient(120deg,#0B1629_0%,#11284A_62%,#0E3A33_100%)] px-4 py-3.5 text-white">
              <div>
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#8FA3BF]">
                  M-Pesa account
                </div>
                <div className="font-mono text-[22px] font-bold tracking-[0.08em]">{m.no}</div>
              </div>
              <div className="max-w-[140px] text-right text-[11.5px] text-[#A3B3C9]">
                Also the card code at the door
              </div>
            </div>
            <section>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Services</div>
              {m.services.length === 0 && <p className="text-[13px] text-ink-500">Nothing paid yet.</p>}
              <ul className="space-y-3">
                {m.services.map((x) => {
                  const start = new Date(x.starts).getTime();
                  const end = new Date(x.ends).getTime();
                  const left = end - now;
                  const pct = left <= 0 ? 0 : Math.max(3, Math.min(100, (left / Math.max(1, end - start)) * 100));
                  const days = Math.ceil(left / DAY);
                  const tone = left <= 0 ? 'text-rose-700' : left <= 7 * DAY ? 'text-amber-700' : 'text-[#047857]';
                  return (
                    <li key={x.name}>
                      <div className="flex justify-between text-[13.5px]">
                        <b className="font-semibold">{x.name}</b>
                        <span className={`text-[12.5px] font-semibold ${tone}`}>
                          {left <= 0 ? 'Ended' : days <= 1 ? `Ends ${hm(new Date(end))}` : `${days} days left`}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <i
                          className={`block h-full rounded-full ${left <= 7 * DAY ? 'bg-amber-500' : 'bg-[#10B981]'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-[11.5px] text-ink-500">
                        {left <= 0 ? 'Ended' : 'Ends'} {short(new Date(end))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            {canPay && (
              <section>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                  Quick actions
                </div>
                <Link
                  href={`/members/${m.id}#pay`}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#047857] text-sm font-semibold text-white hover:bg-[#065F46]"
                >
                  <Smartphone size={16} /> Send M-Pesa prompt
                </Link>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Link href={`/members/${m.id}#cash`} className={act}>
                    <Wallet size={16} /> Record cash
                  </Link>
                  <Link href={`/members/${m.id}#card`} className={act}>
                    <CreditCard size={16} /> {m.card ? 'Replace card' : 'Link card'}
                  </Link>
                  <Link href="/messages" className={act}>
                    <MessageSquare size={16} /> Message
                  </Link>
                </div>
              </section>
            )}
            <div className="grid grid-cols-3 gap-2">
              {[
                ['Card', m.card ? 'Linked' : 'None'],
                ['Door', SYNC[m.sync].label],
                ['Last visit', visit(m.lastVisit)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-xl bg-slate-50 px-3 py-2">
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">{l}</div>
                  <div className="truncate text-[13px] font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <section>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">
                Recent payments
              </div>
              {m.payments.length === 0 && <p className="text-[13px] text-ink-500">No payments yet.</p>}
              <ul className="divide-y divide-slate-100">
                {m.payments.map((p) => (
                  <li key={p.at} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px]">{p.label}</div>
                      <div className="text-[11.5px] text-ink-500">
                        {short(new Date(p.at))} · {p.channel === 'cash' ? 'Cash' : 'M-Pesa'}
                      </div>
                    </div>
                    <b className="shrink-0 text-[13px] tabular-nums">KES {p.kes.toLocaleString('en-KE')}</b>
                  </li>
                ))}
              </ul>
            </section>
            <Link
              href={`/members/${m.id}`}
              className="flex h-11 items-center justify-center gap-1 rounded-xl bg-slate-50 text-sm font-semibold text-ink-900 hover:bg-slate-100"
            >
              Open full profile <ChevronRight size={15} />
            </Link>
          </div>
        )}
      </aside>
    </>
  );
}
