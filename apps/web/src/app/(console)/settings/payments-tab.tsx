import { withTenant } from '@lango/db';
import { Building2, CreditCard, Smartphone } from 'lucide-react';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { TabHead } from './bits';

/**
 * Settings › Payments, read only (3 Oct 2026). NAVAC connects each club's Payment Gateway account, paybill or till
 * and settlement bank during onboarding; the keys stay secret even from partners. The club sees what members pay
 * to and whether it works.
 */
export async function PaymentsTab({ s }: { s: Session }) {
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<
      {
        tp: { env: string } | null;
        ch: {
          paybill?: string | null;
          till?: string | null;
          linksOnly?: boolean;
          settlementBank?: string;
          settlementConfirmed?: boolean;
        } | null;
        last: Date | null;
      }[]
    >`
      select jsonb_build_object('env', ts.data->'taifapay'->>'env') as tp, ts.data->'channels' as ch,
             (select max(paid_at) from payments where provider = 'taifapay' and status = 'applied') as last
      from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${s.tid}`,
  );
  const tp = row?.tp?.env ? row.tp : null;
  const ch = row?.ch ?? {};
  const working = !!tp && tp.env === 'live';
  const pill = (ok: boolean, text: string) => (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}
    >
      <i className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {text}
    </span>
  );
  const tile = (I: typeof CreditCard, label: string, value: React.ReactNode, sub: React.ReactNode) => (
    <div className="card flex items-start gap-3.5 p-5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-50 text-ink-700">
        <I size={18} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-500">{label}</div>
        <div className="mt-1 text-[17px] font-semibold">{value}</div>
        <div className="mt-0.5 text-[12.5px] text-ink-500">{sub}</div>
      </div>
    </div>
  );
  return (
    <>
      <TabHead
        title="Payments"
        sub="Set up by NAVAC. To change any of this, email support@navac.co.ke."
        actions={pill(working, working ? 'Payments working' : tp ? 'Test mode' : 'Not connected yet')}
      />
      <div className="grid gap-4 xl:grid-cols-3">
        {tile(
          CreditCard,
          'Payment Gateway',
          tp ? (tp.env === 'live' ? 'Connected' : 'Connected · test mode') : 'Not connected',
          row?.last
            ? `Last M-Pesa payment ${row.last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            : 'M-Pesa prompts and payment links',
        )}
        {tile(
          Smartphone,
          'Members pay to',
          ch.paybill ? (
            <span className="font-mono">Paybill {ch.paybill}</span>
          ) : ch.till ? (
            <span className="font-mono">Till {ch.till}</span>
          ) : ch.linksOnly ? (
            'Prompts & links'
          ) : (
            'Not set'
          ),
          ch.paybill ? 'Account: the member number' : ch.till ? 'Pay the exact plan price' : '—',
        )}
        {tile(
          Building2,
          'Settles to',
          ch.settlementBank || 'Not set',
          ch.settlementConfirmed ? 'Confirmed by the Payment Gateway' : 'Waiting for confirmation',
        )}
      </div>
    </>
  );
}
