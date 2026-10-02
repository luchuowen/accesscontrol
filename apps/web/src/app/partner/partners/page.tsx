import { redirect } from 'next/navigation';
import { Badge, PageHeader } from '@/components/ui';
import { requirePartner } from '@/lib/session';
import { db } from '@/server/db';
import { resendPartnerInvite, setPartnerActive } from '../actions';
import { AddPartnerForm } from './partner-form';

const MSG: Record<string, [string, string]> = {
  'partner-on': ['green', 'Login switched on.'],
  'partner-off': ['green', 'Login switched off.'],
  self: ['amber', 'You can’t switch off your own login.'],
  'invite-sent': ['green', 'A new invitation is on its way. The earlier link no longer works.'],
  'invite-failed': ['amber', 'That invitation could not be sent. It may already have been accepted.'],
};

export default async function Partners({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const s = await requirePartner();
  const [plat] = await db()<{ ok: boolean }[]>`select app_is_platform(${s.uid}) as ok`;
  if (!plat?.ok) redirect('/partner');
  const { m } = await searchParams;
  const msg = m ? MSG[m] : undefined;
  const partners = await db()<
    { id: string; name: string; email: string; partner: string; active: boolean; accepted_at: Date | null }[]
  >`
    select * from app_platform_partners(${s.uid})`;
  return (
    <>
      <PageHeader
        title="Partners"
        subtitle="Who can sign in to this console. NAVAC admins see every club; installer partners see only their own clubs."
      />
      {msg && (
        <div
          className={`mb-6 rounded-xl p-3 text-sm ring-1 ${msg[0] === 'green' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {msg[1]}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="overflow-hidden rounded-[10px] border border-[#E4E8EF] bg-white">
          <table className="w-full text-[13px]">
            <thead className="border-b border-[#E4E8EF] bg-[#FBFCFD] text-left text-[11px] text-ink-500">
              <tr>
                <th className="px-5 py-2.5 font-medium">Name</th>
                <th className="px-5 py-2.5 font-medium">Company</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F6]">
              {partners.map((p) => (
                <tr key={p.id}>
                  <td className="px-5 py-3">
                    <div className={p.active ? 'font-medium' : 'text-ink-300'}>{p.name}</div>
                    <div className="text-xs text-ink-500">{p.email}</div>
                  </td>
                  <td className="px-5 py-3 text-ink-500">{p.partner}</td>
                  <td className="px-5 py-3">
                    {p.accepted_at ? (
                      <Badge tone={p.active ? 'green' : 'gray'}>{p.active ? 'active' : 'off'}</Badge>
                    ) : (
                      <Badge tone="amber">invited</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {!p.accepted_at ? (
                      <form action={resendPartnerInvite}>
                        <input type="hidden" name="staffId" value={p.id} />
                        <button type="submit" className="text-xs font-medium text-ink-500 hover:text-ink-900">
                          Resend invitation
                        </button>
                      </form>
                    ) : (
                      p.id !== s.uid && (
                        <form action={setPartnerActive}>
                          <input type="hidden" name="staffId" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? 'false' : 'true'} />
                          <button type="submit" className="text-xs font-medium text-ink-500 hover:text-ink-900">
                            {p.active ? 'Switch off' : 'Switch on'}
                          </button>
                        </form>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="self-start rounded-[10px] border border-[#E4E8EF] bg-white p-5">
          <div className="font-medium">Invite a partner</div>
          <div className="text-xs text-ink-500">
            They get an email to set their own password. The link works for 7 days.
          </div>
          <AddPartnerForm />
        </section>
      </div>
    </>
  );
}
