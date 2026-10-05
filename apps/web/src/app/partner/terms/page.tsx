import { Handshake } from 'lucide-react';
import { redirect } from 'next/navigation';
import { SubmitButton } from '@/components/submit-button';
import { PageHeader } from '@/components/ui';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { navacSaveTerms } from '../actions';

export const metadata = { title: 'Partner terms · Lango' };

const MSG: Record<string, [ok: boolean, text: string]> = {
  saved: [true, 'Terms saved. New club payments earn at these rates; past earnings keep the rate they were earned at.'],
  invalid: [false, 'Shares are 0 to 100%, tax 0 to 30%, months 1 to 120 and hold 0 to 90 days.'],
  pin: [false, 'A KRA PIN looks like A123456789B.'],
  denied: [false, 'That partner is no longer there.'],
};

interface Terms {
  partner_id: string;
  partner: string;
  setup_pct: string | null;
  sub_pct: string | null;
  sub_months: number | null;
  hold_days: number;
  wht_pct: string;
  payout_method: string | null;
  payout_to: string | null;
  kra_pin: string | null;
}

const num = (v: string | null) => (v == null ? '' : String(Number(v)));

/** NAVAC only: each partner company's share of the setup fees and subscriptions its clubs pay, and how it is paid. */
export default async function PartnerTerms({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  const [[plat], terms] = await Promise.all([
    db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`,
    db()<Terms[]>`select * from app_partner_terms(${s.uid})`,
  ]);
  if (!plat?.ok) redirect('/partner');
  const { m } = await searchParams;
  const msg = m ? MSG[m] : undefined;
  const lbl = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500';
  return (
    <>
      <PageHeader
        title="Partner terms"
        repeats
        subtitle="What each partner earns from its clubs. Shares are worked out on what the club pays NAVAC; gateway charges stay with NAVAC."
      />
      {msg && (
        <div
          className={`mb-5 rounded-xl p-3 text-sm ring-1 ${msg[0] ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {msg[1]}
        </div>
      )}
      {terms.length === 0 && (
        <p className="rounded-2xl border border-[#E7EBF3] bg-white p-6 text-[13px] text-ink-500">
          No partner organizations yet. Invite a partner admin under Users to add one.
        </p>
      )}
      <div className="grid gap-4">
        {terms.map((t) => (
          <form key={t.partner_id} action={navacSaveTerms} className="rounded-2xl border border-[#E7EBF3] bg-white p-5">
            <input type="hidden" name="partnerId" value={t.partner_id} />
            <header className="mb-4 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <Handshake size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">{t.partner}</div>
                <div className="text-[12px] text-ink-500">
                  {t.setup_pct == null && t.sub_pct == null
                    ? 'No shares set yet: its clubs earn it nothing until you set them.'
                    : `${num(t.setup_pct) || 0}% of setup fees · ${num(t.sub_pct) || 0}% of subscriptions${t.sub_months ? ` for ${t.sub_months} months` : ''}`}
                </div>
              </div>
            </header>
            <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              <label>
                <span className={lbl}>Share of setup fees (%)</span>
                <input name="setupPct" inputMode="decimal" defaultValue={num(t.setup_pct)} className="input py-2" />
              </label>
              <label>
                <span className={lbl}>Share of subscriptions (%)</span>
                <input name="subPct" inputMode="decimal" defaultValue={num(t.sub_pct)} className="input py-2" />
              </label>
              <label>
                <span className={lbl}>Subscription share for (months)</span>
                <input
                  name="months"
                  inputMode="numeric"
                  defaultValue={t.sub_months ?? ''}
                  placeholder="As long as the club pays"
                  className="input py-2"
                />
              </label>
              <label>
                <span className={lbl}>Hold before payable (days)</span>
                <input name="holdDays" inputMode="numeric" defaultValue={t.hold_days} className="input py-2" />
              </label>
              <label>
                <span className={lbl}>Withholding tax (%)</span>
                <input name="whtPct" inputMode="decimal" defaultValue={num(t.wht_pct)} className="input py-2" />
              </label>
              <label>
                <span className={lbl}>Paid by</span>
                <select name="method" defaultValue={t.payout_method ?? ''} className="input py-2">
                  <option value="">Not set</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="paybill">Paybill</option>
                  <option value="till">Till</option>
                  <option value="bank">Bank</option>
                </select>
              </label>
              <label>
                <span className={lbl}>Paid to</span>
                <input
                  name="payoutTo"
                  defaultValue={t.payout_to ?? ''}
                  placeholder="0712 345 678, or paybill + account"
                  className="input py-2"
                />
              </label>
              <label>
                <span className={lbl}>KRA PIN</span>
                <input name="kraPin" defaultValue={t.kra_pin ?? ''} placeholder="A123456789B" className="input py-2" />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <SubmitButton pendingText="Saving…" className="btn-primary py-2">
                Save terms
              </SubmitButton>
            </div>
          </form>
        ))}
      </div>
    </>
  );
}
