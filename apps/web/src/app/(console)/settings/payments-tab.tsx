import { withTenant } from '@lango/db';
import { Building2, CreditCard, Smartphone } from 'lucide-react';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { Group, Pill, Row, SectionHead } from './bits';

/**
 * Settings › Payments, read only (3 Oct 2026). NAVAC connects each club's Payment Gateway account, paybill or till
 * and settlement bank during onboarding; the keys stay secret even from partners.
 */
export async function PaymentsTab({ s }: { s: Session }) {
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) => tx<
      {
        env: string | null;
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
      select ts.data->'taifapay'->>'env' as env, ts.data->'channels' as ch,
             (select max(paid_at) from payments where provider = 'taifapay' and status = 'applied') as last
      from tenants t left join tenant_settings ts on ts.tenant_id = t.id where t.id = ${s.tid}`,
  );
  const env = row?.env ?? null;
  const ch = row?.ch ?? {};
  const working = env === 'live';
  return (
    <>
      <SectionHead
        icon={CreditCard}
        title="Payments"
        sub="Set up by NAVAC. To change anything, email support@navac.co.ke."
        action={<Pill ok={working}>{working ? 'Working' : env ? 'Test mode' : 'Not connected'}</Pill>}
      />
      <Group title="Payment Gateway">
        <Row
          icon={CreditCard}
          label="M-Pesa prompts and payment links"
          hint={
            row?.last
              ? `Last payment ${row.last.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
              : undefined
          }
        >
          <Pill ok={!!env}>{env ? (env === 'live' ? 'Connected' : 'Test mode') : 'Not connected'}</Pill>
        </Row>
      </Group>
      <Group title="Members pay to">
        <Row
          icon={Smartphone}
          label={ch.paybill ? 'Paybill' : ch.till ? 'Till' : 'Paybill or till'}
          hint={
            ch.paybill
              ? 'Account: the member number'
              : ch.till
                ? 'Pay the exact plan price'
                : ch.linksOnly
                  ? 'Prompts and links only'
                  : undefined
          }
        >
          <span className="font-mono">{ch.paybill ?? ch.till ?? '—'}</span>
        </Row>
      </Group>
      <Group title="Settles to">
        <Row icon={Building2} label={ch.settlementBank || 'Bank account'}>
          <Pill ok={ch.settlementConfirmed ? true : null}>
            {ch.settlementConfirmed ? 'Confirmed' : 'Not confirmed'}
          </Pill>
        </Row>
      </Group>
    </>
  );
}
