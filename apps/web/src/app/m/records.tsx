import { withTenant } from '@lango/db';
import { pick } from '@lango/server';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LetterheadDoc } from '@/components/letterhead-doc';
import { date, dateTime, kes } from '@/lib/format';
import { db } from '@/server/db';
import { PrintButton } from '../(console)/settings/sms/print-button';

type Who = { tenantId: string; memberId: string };

/** Member portal screens for the records members used to ask reception for: receipts and visits. */
function Top({ title, sub, back = '/m' }: { title: string; sub?: string; back?: string }) {
  return (
    <header className="mb-4 print:hidden">
      <Link
        href={back}
        className="-ml-1 inline-flex items-center gap-0.5 py-1 text-[13px] font-semibold text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft size={16} /> Back
      </Link>
      <h1 className="mt-2 text-[21px] font-bold leading-tight">{title}</h1>
      {sub && <p className="text-[12.5px] text-ink-500">{sub}</p>}
    </header>
  );
}

const receiptNo = (id: string) => `R-${id.slice(0, 8).toUpperCase()}`;

export async function ReceiptList({ who }: { who: Who }) {
  const rows = await withTenant(
    db(),
    who.tenantId,
    (tx) => tx<{ id: string; paid_at: Date; amount_kes: number; channel: string; what: string | null }[]>`
      select p.id, p.paid_at, p.amount_kes, p.channel,
             coalesce((select string_agg(l.label, ' + ') from payment_lines l where l.payment_id = p.id), pr.name) as what
      from payments p left join products pr on pr.id = p.product_id
      where p.member_id = ${who.memberId} and p.status = 'applied' order by p.paid_at desc limit 60`,
  );
  return (
    <>
      <Top title="Receipts" sub="Tap a payment to open its receipt. You can save it as a PDF or share it." />
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] text-ink-500">
          No payments yet. Receipts appear here as soon as you pay.
        </p>
      ) : (
        <ul className="divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/m?v=receipt&id=${r.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-[#F7F9FC]">
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[14px] font-semibold">{r.what ?? 'Payment'}</b>
                  <span className="block text-[12px] text-ink-500">
                    {date(r.paid_at)} · {r.channel === 'cash' ? 'Cash at the desk' : 'M-Pesa'}
                  </span>
                </span>
                <b className="shrink-0 text-[14px] tabular-nums">{kes(r.amount_kes)}</b>
                <ChevronRight size={16} className="shrink-0 text-ink-400" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export async function MemberReceipt({ who, id }: { who: Who; id: string }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const r = await withTenant(db(), who.tenantId, async (tx) => {
    const [p] = await tx<
      {
        id: string;
        paid_at: Date;
        amount_kes: number;
        channel: string;
        phone: string | null;
        raw: unknown;
        product: string | null;
        first_name: string;
        last_name: string | null;
        member_no: number;
        club: string;
      }[]
    >`select p.id, p.paid_at, p.amount_kes, p.channel, p.phone, p.raw, pr.name as product,
             m.first_name, m.last_name, m.member_no, t.name as club
      from payments p join members m on m.id = p.member_id join tenants t on t.id = p.tenant_id
      left join products pr on pr.id = p.product_id
      where p.id = ${id} and p.member_id = ${who.memberId} and p.status = 'applied'`;
    if (!p) return null;
    const lines = await tx<{ label: string; price_kes: number; starts_at: Date; ends_at: Date }[]>`
      select label, price_kes, starts_at, ends_at from payment_lines where payment_id = ${id} order by price_kes desc`;
    const [wa] = await tx<{ phone: string | null }[]>`
      select config->>'displayPhone' as phone from comm_channels where channel = 'whatsapp' and enabled`;
    return { p, lines, wa: wa?.phone ?? undefined };
  });
  if (!r) notFound();
  const { p } = r;
  const code = pick(p.raw, 'mpesaReceiptNumber', 'MpesaReceiptNumber', 'receiptNumber', 'mpesaReceipt', 'mpesaRef');
  const mpesa = typeof code === 'string' && code ? code : null;
  const no = receiptNo(p.id);
  const cash = p.channel === 'cash';
  const lines = r.lines.length
    ? r.lines.map((l) => ({
        title: l.label,
        note: `${date(l.starts_at)} to ${date(l.ends_at)}`,
        cells: [kes(l.price_kes)],
      }))
    : [{ title: p.product ?? 'Payment', cells: [kes(p.amount_kes)] }];
  return (
    <>
      <Top title="Receipt" back="/m?v=receipts" />
      <div className="mb-3 flex justify-end print:hidden">
        <PrintButton />
      </div>
      <LetterheadDoc
        seller={{ name: p.club, phone: r.wa }}
        title="Receipt"
        number={no}
        state="paid"
        facts={[
          { k: 'Receipt no.', v: no, mono: true },
          { k: 'Date paid', v: dateTime(p.paid_at) },
          { k: 'Paid by', v: cash ? 'Cash at the desk' : 'M-Pesa' },
          { k: 'M-Pesa code', v: mpesa ?? '—', mono: true },
        ]}
        billedTo={[p.first_name, p.last_name].filter(Boolean).join(' ')}
        billedNote={`Member ${p.member_no}`}
        issued={dateTime(p.paid_at)}
        columns={['Description', 'Amount']}
        lines={lines}
        totalLabel="Total paid"
        total={kes(p.amount_kes)}
        notes={
          <div>
            {cash ? 'Paid in cash at reception.' : `Paid by M-Pesa${mpesa ? `, receipt ${mpesa}` : ''}.`} Access opened
            on member card {p.member_no} for the dates shown.
          </div>
        }
      />
    </>
  );
}

export async function VisitList({ who }: { who: Who }) {
  const rows = await withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<{ member_no: number }[]>`select member_no from members where id = ${who.memberId}`;
    if (!m) return [];
    return tx<{ at: Date; zone: string | null; granted: boolean }[]>`
      select e.at, z.name as zone, e.granted from access_events e
      left join zones z on e.reader_id = any(z.reader_ids) and z.site_id = e.site_id
      where e.member_no = ${m.member_no} and e.at > now() - interval '60 days' order by e.at desc limit 100`;
  });
  const month = rows.filter((r) => r.granted && r.at >= new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  return (
    <>
      <Top
        title="My visits"
        sub={`${month.length} ${month.length === 1 ? 'visit' : 'visits'} this month · last 60 days below`}
      />
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] text-ink-500">
          No visits in the last 60 days. Each time your card opens a door it shows here.
        </p>
      ) : (
        <ul className="divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
          {rows.map((r) => (
            <li key={`${r.at.toISOString()}-${r.zone}`} className="flex items-center gap-3 px-4 py-3">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.granted ? 'bg-emerald-500' : 'bg-rose-500'}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <b className="block text-[13.5px] font-semibold">{r.zone ?? 'Club door'}</b>
                <span className="block text-[12px] text-ink-500">{dateTime(r.at)}</span>
              </span>
              <span className={`text-[12px] font-semibold ${r.granted ? 'text-emerald-700' : 'text-rose-600'}`}>
                {r.granted ? 'Entered' : 'Turned away'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
