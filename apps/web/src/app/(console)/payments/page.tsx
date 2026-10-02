import Link from 'next/link';
import { Badge, PageHeader, Stat } from '@/components/ui';
import { payments } from '@/lib/data';
import { dateTime, kes } from '@/lib/format';
import { requireSession } from '@/lib/session';

export default async function Payments() {
  const s = await requireSession();
  const rows = await payments(s.tid);
  const applied = rows.filter((r) => r.status === 'applied');
  const unmatched = rows.filter((r) => r.status === 'unmatched');
  const sum = (xs: readonly { amount_kes: number }[]) => xs.reduce((a, b) => a + b.amount_kes, 0);
  // Everything except cash goes through TaifaPay (M-Pesa prompt, paybill/till, card, bank) and carries the convenience fee.
  const viaTaifa = applied.filter((r) => r.channel !== 'cash');
  const cash = applied.filter((r) => r.channel === 'cash');
  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Every shilling, where it came from, and what it unlocked. Compare these totals with your M-Pesa and bank statements."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Applied (last 200)" value={kes(sum(applied))} />
        <Stat label="Through TaifaPay" value={kes(sum(viaTaifa))} hint="M-Pesa, paybill, card, bank" />
        <Stat label="Cash at the desk" value={kes(sum(cash))} hint="recorded by staff, audited" />
        <Stat
          label="Unmatched"
          value={unmatched.length}
          hint="held — no access granted"
          tone={unmatched.length ? 'warn' : 'default'}
        />
      </div>
      <div className="card mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left">
            <tr>
              {['When', 'Member', 'Account', 'Plan', 'Amount', 'Source', 'Reference', 'Status'].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-ink-50/50">
                <td className="whitespace-nowrap px-5 py-2.5 text-ink-500">{dateTime(p.paid_at)}</td>
                <td className="px-5 py-2.5">
                  {p.member_id ? (
                    <Link href={`/members/${p.member_id}`} className="hover:underline">
                      {p.member}
                    </Link>
                  ) : (
                    <span className="text-ink-300">—</span>
                  )}
                </td>
                <td className="px-5 py-2.5 font-mono text-xs">{p.account_ref ?? '—'}</td>
                <td className="px-5 py-2.5">{p.product ?? '—'}</td>
                <td className="px-5 py-2.5 tabular-nums">{kes(p.amount_kes)}</td>
                <td className="px-5 py-2.5 text-ink-500">
                  {p.channel === 'cash'
                    ? `Cash · ${p.recorded_by ?? 'staff'}`
                    : p.provider === 'taifapay' || p.provider === 'seed'
                      ? `TaifaPay · ${p.channel === 'mpesa' ? 'M-Pesa' : p.channel}`
                      : p.provider.replace('desk-', 'desk · ')}
                </td>
                <td className="max-w-[140px] truncate px-5 py-2.5 font-mono text-[11px] text-ink-500">
                  {p.provider_txn_id}
                </td>
                <td className="px-5 py-2.5">
                  {p.status === 'applied' ? (
                    <Badge tone="green">applied</Badge>
                  ) : (
                    <Badge tone="amber">{p.status}</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
