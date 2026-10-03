import { partnerRoleLabel, partnerTeam, staffById } from '@lango/server';
import { redirect } from 'next/navigation';
import { SubmitButton } from '@/components/submit-button';
import { Badge, PageHeader } from '@/components/ui';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { assignTechClubs, resendPartnerInvite, setPartnerActive } from '../actions';
import { AddPartnerForm } from './partner-form';

export const metadata = { title: 'People · Lango' };

const MSG: Record<string, [string, string]> = {
  'partner-on': ['green', 'Login switched on.'],
  'partner-off': ['green', 'Login switched off. They were signed out at once.'],
  self: ['amber', 'You can’t switch off your own login.'],
  denied: ['amber', 'You can’t change that login.'],
  missing: ['amber', 'That person was not found.'],
  assigned: ['green', 'Clubs assigned. The technician sees them on their next page.'],
  'invite-sent': ['green', 'A new invitation is on its way. The earlier link no longer works.'],
  'invite-failed': ['amber', 'That invitation could not be sent. It may already have been accepted.'],
};

export default async function People({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  if (s.kind !== 'partner_admin') redirect('/partner');
  const { m } = await searchParams;
  const msg = m ? MSG[m] : undefined;
  const [[plat], me, people, clubs] = await Promise.all([
    db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`,
    staffById(db(), s.uid),
    partnerTeam(db(), s.uid),
    db()<{ id: string; name: string; partner_id: string | null }[]>`
      select c.id, c.name, t.partner_id from app_partner_clubs(${s.uid}) c join tenants t on t.id = c.id`,
  ]);
  const platform = !!plat?.ok;
  const company = people.find((p) => p.id === s.uid)?.partner ?? 'NAVAC Global';
  return (
    <>
      <PageHeader
        title="People"
        subtitle={
          platform
            ? 'Everyone who signs in to this console: NAVAC staff, and partner companies with their technicians.'
            : `Everyone at ${company} who signs in to Lango. Technicians see only the clubs you assign them.`
        }
      />
      {msg && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${msg[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="overflow-hidden rounded-[10px] border border-[#E4E8EF] bg-white">
          <ul className="divide-y divide-[#F0F2F6]">
            {people.map((p) => (
              <li key={p.id} className="px-5 py-4 text-[13px]">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className={`font-medium ${p.active || !p.accepted_at ? '' : 'text-ink-300'}`}>
                      {p.name}
                      {p.id === s.uid && <span className="ml-1.5 text-xs font-normal text-ink-500">(you)</span>}
                    </div>
                    <div className="truncate text-xs text-ink-500">
                      {p.email} · {p.partner}
                    </div>
                  </div>
                  <Badge tone="blue">{partnerRoleLabel(p)}</Badge>
                  {!p.accepted_at ? (
                    <Badge tone="amber">invited</Badge>
                  ) : (
                    <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'active' : 'off'}</Badge>
                  )}
                  {p.id !== s.uid &&
                    (!p.accepted_at ? (
                      <form action={resendPartnerInvite}>
                        <input type="hidden" name="staffId" value={p.id} />
                        <button type="submit" className="text-xs font-medium text-ink-500 hover:text-ink-900">
                          Resend invitation
                        </button>
                      </form>
                    ) : (
                      <form action={setPartnerActive}>
                        <input type="hidden" name="staffId" value={p.id} />
                        <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                        <button type="submit" className="text-xs font-medium text-ink-500 hover:text-ink-900">
                          {p.active ? 'Switch off' : 'Switch on'}
                        </button>
                      </form>
                    ))}
                </div>
                {p.role === 'partner_tech' && (
                  <details className="mt-2">
                    <summary className="cursor-pointer list-none text-xs font-medium text-ink-500 hover:text-ink-900">
                      Clubs: {p.clubs.length ? p.clubs.join(', ') : 'none yet'} · change
                    </summary>
                    <form
                      action={assignTechClubs}
                      className="mt-2 grid gap-1.5 rounded-xl bg-ink-50/60 p-3 sm:w-[380px]"
                    >
                      <input type="hidden" name="staffId" value={p.id} />
                      {clubs
                        .filter((c) => c.partner_id === p.partner_id)
                        .map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-[13px]">
                            <input
                              type="checkbox"
                              name="club"
                              value={c.id}
                              defaultChecked={p.clubs.includes(c.name)}
                              className="h-4 w-4 accent-ink-900"
                            />
                            {c.name}
                          </label>
                        ))}
                      <SubmitButton pendingText="Saving…" className="btn-ghost mt-1 py-2 text-xs">
                        Save clubs
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="self-start rounded-[10px] border border-[#E4E8EF] bg-white p-5">
          <div className="font-medium">Invite someone</div>
          <div className="text-xs text-ink-500">
            They get an email to set their own password. The link works for 7 days.
          </div>
          <AddPartnerForm
            platform={platform}
            company={me?.partner_id ? company : 'NAVAC Global'}
            companies={[
              ...new Set(people.map((p) => p.partner).filter((c): c is string => !!c && c !== 'NAVAC Global')),
            ]}
          />
        </section>
      </div>
    </>
  );
}
