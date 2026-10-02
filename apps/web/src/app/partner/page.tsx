import { onboardingChecklist } from '@lango/server';
import { ArrowRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { Badge, PageHeader, Stat } from '@/components/ui';
import { ago, kes } from '@/lib/format';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { openClub } from './actions';

interface Row {
  id: string;
  slug: string;
  name: string;
  partner: string | null;
  members: number;
  active_members: number;
  via_taifapay: string;
  cash: string;
  unmatched: number;
  bridge_seen: Date | null;
  taifapay_env: string | null;
  paybill: string | null;
  till: string | null;
}

export default async function PartnerHome() {
  const s = await requirePartner();
  const rows = await db()<Row[]>`
    select c.id, c.slug, c.name, c.partner, st.members, st.active_members, st.via_taifapay, st.cash, st.unmatched,
           st.bridge_seen, st.taifapay_env, st.paybill, st.till
    from app_partner_clubs(${s.uid}) c join app_partner_stats(${s.uid}) st on st.tenant_id = c.id`;
  const progress = await Promise.all(
    rows.map(async (r) => {
      const items = await onboardingChecklist(db(), r.id);
      return { id: r.id, done: items.filter((i) => i.done).length, total: items.length };
    }),
  );
  const prog = new Map(progress.map((p) => [p.id, p]));
  const taifa = rows.reduce((a, r) => a + Number(r.via_taifapay), 0);
  const cash = rows.reduce((a, r) => a + Number(r.cash), 0);
  return (
    <>
      <PageHeader
        title="Clubs"
        subtitle="Every club on Lango, how far its setup has come, and what flowed through TaifaPay in the last 30 days."
        actions={
          <Link href="/partner/new" className="btn-primary">
            <Plus size={16} /> Add a club
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Clubs" value={rows.length} />
        <Stat label="Through TaifaPay · 30 days" value={kes(taifa)} hint="fee-earning volume" />
        <Stat label="Cash · 30 days" value={kes(cash)} hint="recorded at the desk" />
        <Stat label="Active members" value={rows.reduce((a, r) => a + r.active_members, 0)} />
      </div>
      <div className="card mt-6 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50/60 text-left">
            <tr>
              {['Club', 'Setup', 'Payments', 'Doors', 'Members', 'TaifaPay · 30 d', 'Cash · 30 d', ''].map((h) => (
                <th key={h} className="label px-5 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => {
              const p = prog.get(r.id);
              const online = r.bridge_seen && Date.now() - r.bridge_seen.getTime() < 10 * 60_000;
              return (
                <tr key={r.id} className="hover:bg-ink-50/50">
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-[11px] text-ink-500">
                      {r.slug}
                      {r.partner ? ` · ${r.partner}` : ''}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {p && (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${Math.round((p.done / p.total) * 100)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-ink-500">
                          {p.done}/{p.total}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    {r.taifapay_env ? (
                      <Badge tone="green">TaifaPay {r.taifapay_env}</Badge>
                    ) : (
                      <Badge tone="amber">not connected</Badge>
                    )}
                    <div className="mt-1 text-ink-500">
                      {r.paybill ? `Paybill ${r.paybill}` : r.till ? `Till ${r.till}` : 'links & prompts'}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    <Badge tone={online ? 'green' : r.bridge_seen ? 'amber' : 'gray'}>
                      {online ? 'online' : r.bridge_seen ? `seen ${ago(r.bridge_seen)}` : 'not installed'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {r.active_members} <span className="text-ink-500">/ {r.members}</span>
                    {r.unmatched > 0 && (
                      <div className="text-[11px] text-amber-700">{r.unmatched} payment(s) to assign</div>
                    )}
                  </td>
                  <td className="px-5 py-3 tabular-nums">{kes(Number(r.via_taifapay))}</td>
                  <td className="px-5 py-3 tabular-nums text-ink-500">{kes(Number(r.cash))}</td>
                  <td className="px-5 py-3 text-right">
                    <form action={openClub}>
                      <input type="hidden" name="tenantId" value={r.id} />
                      <button type="submit" className="btn-ghost px-3 py-1.5 text-xs">
                        Open <ArrowRight size={14} />
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-10 text-center text-sm text-ink-500">No clubs yet. Add the first one.</div>
        )}
      </div>
    </>
  );
}
