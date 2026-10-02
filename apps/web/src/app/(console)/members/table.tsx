'use client';
import { ChevronRight, CreditCard, Loader2, MessageSquare, Smartphone, Wallet, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { type MemberPreview, memberPreview } from './preview';

/** Members list + side drawer (design C). Rows come from the server already filtered. */
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
  endsAt: string | null;
  renewKes: number;
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
export const STATUS: Record<Row['status'], { label: string; cls: string; dot: string }> = {
  active: { label: 'Active', cls: 'text-ink-700', dot: 'bg-emerald-500' },
  ending: { label: 'Ending soon', cls: 'text-ink-700', dot: 'bg-amber-500' },
  lapsed: { label: 'Lapsed', cls: 'text-ink-700', dot: 'bg-rose-500' },
  never: { label: 'Never paid', cls: 'text-ink-500', dot: 'bg-slate-300' },
  inactive: { label: 'Inactive', cls: 'text-ink-500', dot: 'bg-slate-300' },
};
const SYNC = {
  synced: { label: 'Synced', dot: 'bg-emerald-500' },
  pending: { label: 'Pending', dot: 'bg-amber-500' },
  failed: { label: 'Failed', dot: 'bg-rose-500' },
};

const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
/** Time left in words, from the row's soonest running end (or last end when nothing runs). */
function timeLeft(r: Row): { text: string; cls: string } {
  if (r.status === 'never') return { text: 'Not started', cls: 'text-ink-500' };
  if (!r.endsAt) return { text: '—', cls: 'text-ink-500' };
  const d = new Date(r.endsAt);
  const ms = d.getTime() - Date.now();
  if (ms <= 0) {
    const days = Math.max(1, Math.floor(-ms / DAY));
    return r.status === 'lapsed'
      ? { text: days === 1 ? 'Ended yesterday' : `Ended ${days} days ago`, cls: 'font-semibold text-rose-700' }
      : { text: `Ended ${short(d)}`, cls: 'text-ink-500' };
  }
  const tone = r.status === 'ending' ? 'font-semibold text-amber-700' : 'text-ink-500';
  if (dayKey(d) === dayKey(new Date()))
    return { text: d.getHours() >= 18 ? 'Ends tonight' : `Ends ${hm(d)}`, cls: tone };
  const days = Math.ceil(ms / DAY);
  return { text: days === 1 ? '1 day left' : `${days} days left`, cls: tone };
}

const GROUPS: { key: string; title: string; hint: string; has: Row['status'][]; dot?: string }[] = [
  {
    key: 'act',
    title: 'Needs action',
    hint: 'Ending this week or recently lapsed',
    has: ['ending', 'lapsed'],
    dot: 'bg-amber-500',
  },
  { key: 'on', title: 'Active', hint: 'Paid up', has: ['active'] },
  { key: 'never', title: 'Never paid', hint: 'Added, no payment yet', has: ['never'] },
  { key: 'past', title: 'Past members', hint: 'Ended more than 30 days ago', has: ['inactive'] },
];

/** Members list grouped by who needs action first (design C), with the side drawer. Rows arrive filtered and ordered. */
export function MemberGroups({ rows, canPay, q }: { rows: Row[]; canPay: boolean; q: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const mark = (t: string) => {
    const n = q.trim();
    const i = n ? t.toLowerCase().indexOf(n.toLowerCase()) : -1;
    if (i < 0) return t;
    return (
      <>
        {t.slice(0, i)}
        <mark className="rounded-[3px] bg-amber-100 px-px text-inherit">{t.slice(i, i + n.length)}</mark>
        {t.slice(i + n.length)}
      </>
    );
  };
  return (
    <>
      <div className="mb-1.5 hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_140px] gap-4 px-[17px] text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 md:grid">
        <span>Member</span>
        <span>Phone</span>
        <span>Services</span>
        <span>Last visit</span>
        <span className="text-right">Time left</span>
      </div>
      {GROUPS.map((g) => {
        const list = rows.filter((r) => g.has.includes(r.status));
        if (!list.length) return null;
        const due = g.key === 'act' ? list.reduce((a, r) => a + r.renewKes, 0) : 0;
        return (
          <section key={g.key} className="mb-4 overflow-hidden rounded-2xl border border-[#E7EBF3] bg-white">
            <header className="flex items-center gap-2.5 border-b border-[#EEF1F6] px-4 py-3">
              {g.dot && <i className={`h-2 w-2 rounded-full ${g.dot}`} />}
              <h2 className="text-[14px] font-semibold">{g.title}</h2>
              <span className="text-[12px] tabular-nums text-ink-500">{list.length}</span>
              <span className="ml-auto hidden text-[12px] text-ink-500 sm:block">
                {due ? `${kes(due)} to renew` : g.hint}
              </span>
            </header>
            <ul className="divide-y divide-[#EEF1F6]">
              {list.map((r) => {
                const t = timeLeft(r);
                const running = r.services.filter((x) => new Date(x.ends).getTime() > Date.now());
                const shown = (running.length ? running : r.services.slice(0, 1)).map((x) => x.name);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(r.id)}
                      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left transition hover:bg-slate-50 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_140px] ${open === r.id ? 'bg-slate-50 shadow-[inset_3px_0_0_#0c1220]' : ''}`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-[12px] font-semibold text-ink-700">
                          {initials(r.name)}
                        </span>
                        <span className="min-w-0">
                          <b className="block truncate text-[13.5px] font-semibold text-ink-900">
                            {mark(r.name)}
                            {r.sync === 'failed' && (
                              <span className="ml-2 align-middle text-[11px] font-semibold text-rose-700">
                                Door update failed
                              </span>
                            )}
                          </b>
                          <span className="block truncate text-[12px] tabular-nums text-ink-500">
                            #{mark(String(r.no))}
                            <span className="md:hidden"> · {mark(phoneLabel(r.phone))}</span>
                          </span>
                        </span>
                      </span>
                      <span className="hidden whitespace-nowrap text-[13px] tabular-nums text-ink-700 md:block">
                        {r.phone ? mark(phoneLabel(r.phone)) : <span className="text-ink-500">—</span>}
                      </span>
                      <span className="hidden truncate text-[13px] text-ink-900 md:block">
                        {shown.length ? shown.join(' + ') : <span className="text-ink-500">No service yet</span>}
                      </span>
                      <span className="hidden text-[12.5px] text-ink-500 md:block">{visit(r.lastVisit)}</span>
                      <span className="text-right">
                        <span className={`block whitespace-nowrap text-[12.5px] ${t.cls}`}>{t.text}</span>
                        {g.key === 'act' && r.renewKes > 0 && (
                          <span className="block text-[12px] tabular-nums text-ink-500">{kes(r.renewKes)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
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
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-slate-100 text-[15px] font-semibold text-ink-700">
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
                  <Link href={`/communications/start?member=${m.id}`} className={act}>
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
