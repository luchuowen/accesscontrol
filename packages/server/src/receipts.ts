import type { Sql } from '@lango/db';
import { withTenant } from '@lango/db';
import { accountEmail, sendEmail } from './email.js';

/**
 * Payment receipt by email for what a club pays NAVAC (setup fee, subscription, SMS credit), alongside the SMS
 * receipt. Goes to the club's billing email. Never throws; the key makes a retried settlement send it once.
 */
export async function emailClubReceipt(
  sql: Sql,
  r: {
    tenantId: string;
    docPath: string;
    invoiceNo: string;
    amountKes: number;
    what: string;
    detail?: string;
    mpesa: string | null;
  },
): Promise<boolean> {
  try {
    const [p] = await withTenant(
      sql,
      r.tenantId,
      (tx) => tx<{ email: string | null; club: string }[]>`
        select cp.billing_email as email, t.name as club from tenants t
        left join club_plans cp on cp.tenant_id = t.id where t.id = ${r.tenantId}`,
    );
    if (!p?.email) return false;
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
    const kes = `KES ${r.amountKes.toLocaleString('en-KE')}`;
    const mail = accountEmail({
      eyebrow: 'Payment received',
      heading: `Thank you, ${p.club}`,
      amount: kes,
      paragraphs: [
        `We have received **${kes}** for **${r.what}**.`,
        ...(r.detail ? [r.detail] : []),
        'Your receipt is ready to view or save as a PDF.',
      ],
      button: base ? { label: 'View receipt', url: `${base}${r.docPath}` } : undefined,
      after: [`Receipt ${r.invoiceNo}${r.mpesa ? ` · M-Pesa ${r.mpesa}` : ''}`],
    });
    return await sendEmail(sql, {
      to: p.email,
      subject: `Payment received: ${kes} (${r.invoiceNo})`,
      html: mail.html,
      text: mail.text,
      kind: 'receipt',
      key: `receipt-${r.invoiceNo}`,
      tenantId: r.tenantId,
    });
  } catch (e) {
    console.error(`receipt email ${r.invoiceNo}: ${(e as Error).message}`);
    return false;
  }
}
