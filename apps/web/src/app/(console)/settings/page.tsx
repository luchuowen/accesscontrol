import { can, type Perm } from '@lango/server';
import { Building2, CreditCard, MessageSquare, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { requireSession } from '@/lib/session';
import { ClubTab } from './club-tab';
import { MessagesTab } from './messages-tab';
import { PaymentsTab } from './payments-tab';
import { TeamTab } from './team-tab';

/**
 * Settings, laid out like NAVAC CRM (2 Oct 2026): a left list of sections and one section at a time, deep-linked
 * with ?tab=. Team & roles moved here from its own page; what gets sent by SMS moved here from Messages.
 */
const TABS = [
  { key: 'club', label: 'Club', hint: 'Setup and details', icon: Building2, any: [] as Perm[] },
  {
    key: 'payments',
    label: 'Payments',
    hint: 'Gateway, paybill or till',
    icon: CreditCard,
    any: ['settings.payments'],
  },
  {
    key: 'messages',
    label: 'Messages & SMS',
    hint: 'What gets sent, SMS credit',
    icon: MessageSquare,
    any: ['messages.manage', 'sms.buy'],
  },
  {
    key: 'team',
    label: 'Team & roles',
    hint: 'Who signs in, and what they may do',
    icon: UsersRound,
    any: ['team.manage'],
  },
] as const;

type Params = { tab?: string; m?: string; taifa?: string; ch?: string; sms?: string };

export default async function Settings({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requireSession();
  const tabs = TABS.filter((t) => t.key === 'club' || t.any.some((p) => can(s, p)));
  if (
    tabs.length === 1 &&
    !(['settings.payments', 'sms.buy', 'messages.manage', 'team.manage'] as const).some((p) => can(s, p))
  )
    redirect('/?denied=1');
  const sp = await searchParams;
  // Old links (?taifa=, ?ch=, ?sms=) land on their section.
  const want = sp.tab ?? (sp.taifa || sp.ch ? 'payments' : sp.sms ? 'messages' : 'club');
  const tab = tabs.find((t) => t.key === want) ?? tabs[0];
  return (
    <>
      <PageHeader title="Settings" subtitle="How the club is set up: payments, messages and the team." />
      <div className="grid items-start gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="card p-2 lg:sticky lg:top-20">
          {tabs.map((t) => {
            const on = t.key === tab?.key;
            const I = t.icon;
            return (
              <Link
                key={t.key}
                href={`/settings?tab=${t.key}`}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition ${on ? 'bg-emerald-50 text-emerald-700' : 'text-ink-700 hover:bg-ink-50'}`}
              >
                <I size={17} className={on ? 'text-emerald-600' : 'text-ink-300'} />
                <span className="min-w-0">
                  <b className="block text-[13.5px] font-semibold">{t.label}</b>
                  <span className={`block truncate text-[11.5px] ${on ? 'text-emerald-700/70' : 'text-ink-500'}`}>
                    {t.hint}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="min-w-0">
          {tab?.key === 'payments' ? (
            <PaymentsTab s={s} taifa={sp.taifa} ch={sp.ch} />
          ) : tab?.key === 'messages' ? (
            <MessagesTab s={s} m={sp.m} sms={sp.sms} />
          ) : tab?.key === 'team' ? (
            <TeamTab m={sp.m} />
          ) : (
            <ClubTab s={s} />
          )}
        </div>
      </div>
    </>
  );
}
