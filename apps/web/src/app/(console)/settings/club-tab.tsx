import { onboardingChecklist } from '@lango/server';
import { Mail, MessageCircle, MessageSquare } from 'lucide-react';
import { Checklist } from '@/components/checklist';
import { channelState } from '@/lib/comms-data';
import { date } from '@/lib/format';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { TabHead } from './bits';

/** Settings › Club: setup progress, the club's details and which ways of reaching members are connected. */
export async function ClubTab({ s }: { s: Session }) {
  const [[t], checklist, ch] = await Promise.all([
    db()<{ name: string; slug: string; timezone: string; created_at: Date; partner: string | null }[]>`
      select t.name, t.slug, t.timezone, t.created_at, p.name as partner
      from tenants t left join partners p on p.id = t.partner_id where t.id = ${s.tid}`,
    onboardingChecklist(db(), s.tid),
    channelState(s.tid),
  ]);
  const by = t?.partner ?? 'NAVAC';
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt className="text-[13px] text-ink-500">{k}</dt>
      <dd className="text-right text-[13.5px] font-medium">{v}</dd>
    </div>
  );
  const channel = (I: typeof Mail, name: string, on: boolean, detail: string) => (
    <li className="flex items-center gap-3 py-3">
      <span
        className={`grid h-9 w-9 place-items-center rounded-xl ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-50 text-ink-300'}`}
      >
        <I size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <b className="block text-[13.5px]">{name}</b>
        <span className="text-[12px] text-ink-500">{detail}</span>
      </div>
      <span
        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-ink-500'}`}
      >
        {on ? 'Connected' : 'Not connected'}
      </span>
    </li>
  );
  return (
    <>
      <TabHead title="Club" sub="Setup progress and the club’s details." />
      <div className="space-y-4">
        <Checklist items={checklist} />
        <div className="grid gap-4 xl:grid-cols-2">
          <section className="card p-6">
            <div className="font-medium">Details</div>
            <dl className="mt-2 divide-y divide-ink-100">
              {row('Club name', t?.name)}
              {row('Club code', <span className="font-mono">{t?.slug}</span>)}
              {row('Time zone', t?.timezone)}
              {row('Set up by', by)}
              {row('On Lango since', t ? date(t.created_at) : '')}
            </dl>
            <p className="mt-3 text-[12px] text-ink-500">To change the club’s name or code, ask {by}.</p>
          </section>
          <section className="card p-6">
            <div className="font-medium">Ways to reach members</div>
            <p className="mt-0.5 text-[12px] text-ink-500">
              Connected by {by}. Conversations are under Communications.
            </p>
            <ul className="mt-2 divide-y divide-ink-100">
              {channel(
                MessageSquare,
                'SMS',
                ch.sms.on,
                ch.sms.on ? 'Receipts, reminders, news and replies' : (ch.sms.why ?? ''),
              )}
              {channel(
                MessageCircle,
                'WhatsApp',
                ch.whatsapp.on,
                ch.whatsapp.on
                  ? (ch.whatsapp.number ?? 'The club’s WhatsApp Business number')
                  : 'Members can message the club on WhatsApp',
              )}
              {channel(
                Mail,
                'Email',
                ch.email.on,
                ch.email.on
                  ? ch.email.address
                    ? `Replies arrive at ${ch.email.address}`
                    : 'Sending only'
                  : 'Write to members by email, under the club’s name',
              )}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
