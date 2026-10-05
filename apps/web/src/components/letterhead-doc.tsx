import type { ReactNode } from 'react';
import { LangoMark } from './logo';

export interface Seller {
  name: string;
  address?: string;
  pin?: string;
  email?: string;
  phone?: string;
}
export interface DocLine {
  title: string;
  note?: string;
  cells: string[];
}

/**
 * Receipts and invoices from NAVAC (club subscription, setup fee, SMS credit), design A "Letterhead" (5 Oct 2026):
 * navy letterhead with NAVAC's details and a PAID stamp, a strip with the four facts an accountant looks for, the
 * lines and totals, and a footer. Prints as a full A4 page with no browser date, title or web address.
 */
export function LetterheadDoc({
  seller,
  title,
  number,
  state,
  facts,
  billedTo,
  billedNote,
  issued,
  columns,
  lines,
  totalLabel,
  total,
  notes,
}: {
  seller: Seller;
  title: 'Receipt' | 'Invoice';
  number: string;
  state: 'paid' | 'pending' | 'failed';
  facts: { k: string; v: string; mono?: boolean }[];
  billedTo: string;
  billedNote?: string;
  issued: string;
  columns: string[];
  lines: DocLine[];
  totalLabel: string;
  total: string;
  notes: ReactNode;
}) {
  const contact = [seller.address, seller.email, seller.phone].filter(Boolean).join(' · ');
  const stamp =
    state === 'paid'
      ? 'border-emerald-400 text-emerald-300'
      : state === 'pending'
        ? 'border-amber-300 text-amber-200'
        : 'border-slate-400 text-slate-300';
  return (
    <article className="print-doc mx-auto flex max-w-[860px] flex-col overflow-hidden rounded-[18px] bg-white text-ink-900 shadow-[0_20px_50px_-24px_rgba(11,22,41,0.35)] ring-1 ring-[#E7EBF3] [print-color-adjust:exact] print:min-h-[297mm] print:max-w-none print:rounded-none print:shadow-none print:ring-0">
      <header className="relative flex flex-wrap items-start justify-between gap-6 overflow-hidden bg-[radial-gradient(120%_140%_at_0%_0%,#163257_0%,#0B1629_60%)] px-8 py-7 text-white sm:px-10">
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_100%_100%,rgba(16,185,129,0.25),transparent_70%)]" />
        <div className="relative flex items-start gap-3">
          <LangoMark size={38} />
          <div>
            <div className="text-[17px] font-semibold">{seller.name}</div>
            {contact && <div className="mt-0.5 text-[12px] leading-relaxed text-[#A3B3C9]">{contact}</div>}
            {seller.pin && <div className="text-[12px] text-[#A3B3C9]">KRA PIN {seller.pin}</div>}
          </div>
        </div>
        <div className="relative text-right">
          <div className="text-[30px] font-semibold leading-none tracking-tight">{title}</div>
          <div className="mt-1.5 font-mono text-[13px] text-[#A3B3C9]">{number}</div>
          <div
            className={`mt-3 inline-block -rotate-[4deg] rounded-lg border-2 px-3 py-0.5 text-[12px] font-bold tracking-[0.14em] ${stamp}`}
          >
            {state === 'paid' ? 'PAID' : state === 'pending' ? 'AWAITING PAYMENT' : 'NOT PAID'}
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-7 px-8 py-8 sm:px-10">
        <div className="grid grid-cols-2 gap-4 rounded-xl bg-[#F5F7FB] px-5 py-4 sm:grid-cols-4">
          {facts.map((f) => (
            <div key={f.k} className="min-w-0">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">{f.k}</div>
              <div className={`mt-1 text-sm font-semibold ${f.mono ? 'font-mono' : 'tabular-nums'}`}>{f.v}</div>
            </div>
          ))}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">Billed to</div>
            <div className="mt-1 text-[15px] font-semibold">{billedTo}</div>
            {billedNote && <div className="text-[12.5px] text-ink-500">{billedNote}</div>}
          </div>
          <div className="sm:text-right">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-ink-500">Issued</div>
            <div className="mt-1 text-[15px] font-semibold tabular-nums">{issued}</div>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E4E8EF] text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-500">
              {columns.map((c, i) => (
                <th key={c} className={`py-2.5 ${i > 0 ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.title} className="border-b border-[#E4E8EF] align-top">
                <td className="py-3.5">
                  <div className="font-semibold">{l.title}</div>
                  {l.note && <div className="text-[12.5px] text-ink-500">{l.note}</div>}
                </td>
                {l.cells.map((c, i) => (
                  <td key={`${i}-${c}`} className="py-3.5 text-right tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="grid w-full max-w-[280px] gap-2">
            <div className="flex justify-between text-sm text-ink-700">
              <span>Subtotal</span>
              <span className="tabular-nums">{total}</span>
            </div>
            <div className="flex justify-between border-t-2 border-ink-900 pt-2.5 text-xl font-bold">
              <span>{totalLabel}</span>
              <span className="tabular-nums">{total}</span>
            </div>
          </div>
        </div>

        <div className="space-y-1 text-[13px] leading-relaxed text-ink-500">{notes}</div>

        <div className="mt-auto flex flex-wrap justify-between gap-3 border-t border-dashed border-[#D5DBE5] pt-4 text-[12.5px] text-ink-500">
          <span>{state === 'paid' ? 'Thank you. Keep this receipt for your records.' : 'Thank you.'}</span>
          {seller.email && <span>Questions? {seller.email}</span>}
        </div>
      </div>

      <footer className="flex flex-wrap justify-between gap-3 border-t border-[#E4E8EF] px-8 py-3 text-[11px] text-ink-500 sm:px-10">
        <span>{[seller.name, seller.address].filter(Boolean).join(' · ')}</span>
        <span>
          {title} {number}
        </span>
      </footer>
    </article>
  );
}
