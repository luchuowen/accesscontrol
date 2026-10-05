import { onboardingChecklist } from '@lango/server';
import { ChevronRight, Plus } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui';
import { ago, kes } from '@/lib/format';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';

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

const MSG: Record<string, [ok: boolean, text: string]> = {
  'owner-invited': [true, 'Invitation sent to the club owner. The link works for 7 days.'],
  'owner-not-sent': [false, 'The owner was added but the email did not go out. Use “Resend invite”.'],
  'owner-taken': [
    false,
    'That email already belongs to another club. Each login is for one club only; use a different email.',
  ],
  'owner-partner': [false, 'That email belongs to a partner or NAVAC login. Use the club owner’s own email.'],
  'owner-details': [false, 'Enter the owner’s name and a valid email.'],
  'owner-phone': [false, 'Enter the mobile as 07XX XXX XXX, or leave it blank.'],
  'owner-failed': [false, 'The invitation could not be sent. Try again.'],
  denied: [false, 'You can’t do that for this club.'],
};

export default async function PartnerClubs({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  const { m } = await searchParams;
  const msg = m ? MSG[m] : undefined;
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
  const owners = new Map(
    (
      await db()<{ tenant_id: string; owner_name: string | null; owner_email: string | null; accepted: boolean }[]>`
        select * from app_partner_club_owners(${s.uid})`
    ).map((o) => [o.tenant_id, o]),
  );
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  // Member payment volume is NAVAC's business: only NAVAC admins see it.
  const navac = !!plat?.ok;
  return (
    <>
      <PageHeader
        title="Clubs"
        repeats
        subtitle="Every club, how far its setup has come, how members pay and whether its door PC is online."
        actions={
          s.kind === 'partner_admin' && (
            <Link href="/partner/new" className="btn-primary">
              <Plus size={16} /> Add a club
            </Link>
          )
        }
      />
      {msg && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${msg[0] ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-[#E4E8EF] bg-white">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="bg-[#FAFBFC] text-left">
            <tr>
              {[
                'Club',
                'Owner',
                'Setup',
                'Payments',
                'Door PC',
                'Members',
                ...(navac ? ['Gateway · 30 d', 'Cash · 30 d'] : []),
                '',
              ].map((h) => (
                <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F0F2F6]">
            {rows.map((r) => {
              const p = prog.get(r.id);
              const o = owners.get(r.id);
              const online = r.bridge_seen && Date.now() - r.bridge_seen.getTime() < 10 * 60_000;
              const href = `/partner/clubs/${r.id}`;
              const dot = (tone: string, text: string) => (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <i className={`h-1.5 w-1.5 rounded-full ${tone}`} />
                  {text}
                </span>
              );
              return (
                <tr key={r.id} className="group hover:bg-[#FAFBFC]">
                  <td className="min-w-[200px] px-4 py-3.5">
                    <Link href={href} className="whitespace-nowrap font-semibold text-ink-900 hover:underline">
                      {r.name}
                    </Link>
                    <div className="whitespace-nowrap text-[12px] text-ink-500">{r.partner ?? r.slug}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    {o?.owner_email ? (
                      <>
                        <div className="font-medium">{o.owner_name}</div>
                        <div className="text-[12px] text-ink-500">
                          {o.accepted ? o.owner_email : 'invited, not signed up yet'}
                        </div>
                      </>
                    ) : (
                      <Link href={href} className="text-[12.5px] font-medium text-emerald-700 hover:underline">
                        Invite owner
                      </Link>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {p && (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-100">
                          <div
                            className="h-full rounded-full bg-emerald-500"
                            style={{ width: `${Math.round((p.done / p.total) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[12px] tabular-nums text-ink-500">
                          {p.done}/{p.total}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[12.5px]">
                    {r.taifapay_env
                      ? dot('bg-emerald-500', `Gateway ${r.taifapay_env}`)
                      : dot('bg-amber-500', 'Not connected')}
                    <div className="mt-0.5 text-[11.5px] text-ink-500">
                      {r.paybill ? `Paybill ${r.paybill}` : r.till ? `Till ${r.till}` : 'Prompts & links'}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[12.5px]">
                    {online
                      ? dot('bg-emerald-500', 'Online')
                      : r.bridge_seen
                        ? dot('bg-amber-500', `Seen ${ago(r.bridge_seen)}`)
                        : dot('bg-ink-300', 'Not installed')}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums">
                    {r.active_members} <span className="text-ink-500">/ {r.members}</span>
                    {r.unmatched > 0 && <div className="text-[11px] text-amber-700">{r.unmatched} to sort</div>}
                  </td>
                  {navac && (
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums">{kes(Number(r.via_taifapay))}</td>
                  )}
                  {navac && (
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-ink-500">{kes(Number(r.cash))}</td>
                  )}
                  <td className="px-4 py-3.5 text-right">
                    <Link href={href} aria-label={`Open ${r.name}`} className="text-ink-300 group-hover:text-ink-900">
                      <ChevronRight size={18} />
                    </Link>
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
