'use client';
import {
  Banknote,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Search,
  Smartphone,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { findMembers } from './actions';

/** Payments ledger (design A): live search + filters, the table with a details panel, export, and quick actions. */
export type LedgerRow = {
  id: string;
  at: string;
  amount: number;
  status: string;
  cash: boolean;
  provider: string;
  ref: string;
  account: string | null;
  phone: string | null;
  memberId: string | null;
  memberNo: number | null;
  member: string | null;
  product: string | null;
  recordedBy: string | null;
};

const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
const when = (iso: string) => {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const y = new Date(Date.now() - 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
  const hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  if (day === today) return `Today ${hm}`;
  if (day === y) return `Yesterday ${hm}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' })}, ${hm}`;
};
const sel =
  'h-10 rounded-xl border border-[#E5E8EE] bg-white px-3 text-[13px] font-medium text-ink-700 outline-none focus:border-slate-300';

export function LedgerFilters({ full }: { full: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [pending, start] = useTransition();
  const first = useRef(true);
  const go = (patch: Record<string, string>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) v ? u.set(k, v) : u.delete(k);
    u.delete('n');
    start(() => router.replace(u.toString() ? `${path}?${u}` : path, { scroll: false }));
  };
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (q.trim() === (sp.get('q') ?? '')) return;
    const t = setTimeout(() => go({ q: q.trim() }), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#EEF1F6] p-3">
      <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2.5 rounded-xl border border-[#E5E8EE] px-3 text-ink-300 focus-within:border-slate-300">
        {pending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, member no., phone or M-Pesa code"
          aria-label="Search payments"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-300"
        />
      </label>
      {full && (
        <select
          aria-label="Period"
          value={sp.get('p') ?? '30'}
          onChange={(e) => go({ p: e.target.value })}
          className={sel}
        >
          <option value="1">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last 12 months</option>
        </select>
      )}
      <select aria-label="Method" value={sp.get('m') ?? ''} onChange={(e) => go({ m: e.target.value })} className={sel}>
        <option value="">All methods</option>
        <option value="mpesa">M-Pesa</option>
        <option value="cash">Cash</option>
      </select>
      <select aria-label="Status" value={sp.get('s') ?? ''} onChange={(e) => go({ s: e.target.value })} className={sel}>
        <option value="">All statuses</option>
        <option value="applied">Applied</option>
        <option value="unmatched">Needs sorting</option>
      </select>
    </div>
  );
}

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const sp = useSearchParams();
  const qs = (f: string) => {
    const u = new URLSearchParams(sp.toString());
    u.set('f', f);
    u.delete('n');
    return `/payments/export?${u}`;
  };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="btn-primary">
        <Download size={15} /> Export <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-[#E7EBF3] bg-white p-1.5 shadow-lg">
          <a href={qs('xlsx')} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] hover:bg-slate-50">
            <FileSpreadsheet size={15} /> Excel <span className="ml-auto text-[11.5px] text-ink-500">.xlsx</span>
          </a>
          <a href={qs('csv')} className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] hover:bg-slate-50">
            <FileText size={15} /> CSV <span className="ml-auto text-[11.5px] text-ink-500">.csv</span>
          </a>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.print();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-slate-50"
          >
            <FileText size={15} /> PDF <span className="ml-auto text-[11.5px] text-ink-500">print</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** "Record cash" / "Send M-Pesa prompt": pick the member, then their page opens at the right form. */
export function PayFor({ kind }: { kind: 'cash' | 'pay' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [list, setList] = useState<Awaited<ReturnType<typeof findMembers>>>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setList([]);
      return;
    }
    setBusy(true);
    const t = setTimeout(
      () =>
        findMembers(q)
          .then(setList)
          .finally(() => setBusy(false)),
      200,
    );
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQ('');
          ref.current?.showModal();
        }}
        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E8EE] bg-white px-3.5 text-sm font-semibold text-ink-900 hover:bg-slate-50"
      >
        {kind === 'cash' ? <Banknote size={15} /> : <Smartphone size={15} />}
        {kind === 'cash' ? 'Record cash' : 'Send M-Pesa prompt'}
      </button>
      <dialog
        ref={ref}
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-full max-w-[460px] rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px]"
      >
        <div className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[17px] font-semibold">
              {kind === 'cash' ? 'Record cash for…' : 'Send an M-Pesa prompt to…'}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => ref.current?.close()}
              className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>
          <label className="mt-3 flex h-11 items-center gap-2.5 rounded-xl border border-[#E5E8EE] px-3 text-ink-300 focus-within:border-[#047857]">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name, member number or phone"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink-900 outline-none"
            />
          </label>
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {list.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/members/${m.id}#${kind}`}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-[11.5px] font-semibold">
                    {m.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[13.5px] font-semibold">{m.name}</b>
                    <span className="text-[12px] text-ink-500">
                      #{m.no}
                      {m.phone ? ` · ${m.phone}` : ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {q.trim().length >= 2 && !busy && list.length === 0 && (
              <li className="px-3 py-4 text-center text-[13px] text-ink-500">No active member matches.</li>
            )}
          </ul>
        </div>
      </dialog>
    </>
  );
}

export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const [open, setOpen] = useState<LedgerRow | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-[#EEF1F6]">
              {['When', 'Who', 'For', 'Amount', 'Method', 'Status'].map((h) => (
                <th
                  key={h}
                  className={`px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500 ${h === 'Amount' ? 'text-right' : ''}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F2F6]">
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => setOpen(r)}
                className={`cursor-pointer transition hover:bg-slate-50 ${open?.id === r.id ? 'bg-slate-50 shadow-[inset_3px_0_0_#0c1220]' : ''}`}
              >
                <td className="whitespace-nowrap px-4 py-3 text-ink-500">{when(r.at)}</td>
                <td className="px-4 py-3">
                  <b className="block font-semibold text-ink-900">
                    {r.member ?? (r.phone ? `Unknown · ${r.phone}` : 'Unknown')}
                  </b>
                  <span className="text-[12px] text-ink-500">
                    {r.memberNo ? `#${r.memberNo}` : r.account ? `typed “${r.account}”` : ''}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-700">{r.product ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{kes(r.amount)}</td>
                <td className="px-4 py-3">
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-semibold text-ink-700">
                    {r.cash ? 'Cash' : 'M-Pesa'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {r.status === 'applied' ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11.5px] font-semibold text-emerald-700">
                      Applied
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11.5px] font-semibold text-amber-800">
                      Needs sorting
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-30 bg-[#0B1629]/20 print:hidden"
          />
          <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[380px] flex-col gap-4 overflow-y-auto border-l border-[#E7EBF3] bg-white p-5 shadow-[-24px_0_48px_-24px_rgba(11,22,41,0.25)] print:hidden">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">Payment</div>
                <div className="mt-1 text-[26px] font-semibold tabular-nums">{kes(open.amount)}</div>
                <div className="text-[13px] text-ink-500">{when(open.at)}</div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(null)}
                className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <dl className="divide-y divide-[#F0F2F6] rounded-xl border border-[#EEF1F6] text-[13px]">
              {[
                [
                  'Member',
                  open.member ? `${open.member}${open.memberNo ? ` · #${open.memberNo}` : ''}` : 'Not matched',
                ],
                ['For', open.product ?? '—'],
                ['Method', open.cash ? `Cash · recorded by ${open.recordedBy ?? 'staff'}` : 'M-Pesa · Payment Gateway'],
                ['Reference', open.ref],
                ['Account typed', open.account ?? '—'],
                ['Phone', open.phone ?? '—'],
                ['Status', open.status === 'applied' ? 'Applied: access given' : 'Needs sorting: no access yet'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-3.5 py-2.5">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="break-all text-right font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            {open.memberId && (
              <Link href={`/members/${open.memberId}`} className="btn-ghost justify-center">
                Open member
              </Link>
            )}
            {open.status !== 'applied' && (
              <Link href="#sort" onClick={() => setOpen(null)} className="btn-primary justify-center">
                Sort this payment
              </Link>
            )}
          </aside>
        </>
      )}
    </>
  );
}
