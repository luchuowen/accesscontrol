import { can, type Perm } from '@lango/server';
import { Bell, Building2, CreditCard, UsersRound, Wallet } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/session';
import { ClubTab } from './club-tab';
import { NotifyTab } from './notify-tab';
import { PaymentsTab } from './payments-tab';
import { SmsTab } from './sms-tab';
import { TeamTab } from './team-tab';

/**
 * Settings, NAVAC CRM layout (3 Oct 2026): a short list of sections on the left and one panel on the right, each
 * section opened with ?tab=. No page header: the top bar already says Settings.
 */
const TABS = [
  { key: 'club', label: 'Club profile', icon: Building2, any: [] as Perm[] },
  { key: 'payments', label: 'Payments', icon: CreditCard, any: ['settings.payments'] as Perm[] },
  { key: 'sms', label: 'SMS credit', icon: Wallet, any: ['sms.buy', 'messages.manage'] as Perm[] },
  { key: 'notifications', label: 'Notifications', icon: Bell, any: ['messages.manage'] as Perm[] },
  { key: 'team', label: 'Team & roles', icon: UsersRound, any: ['team.manage'] as Perm[] },
] as const;

type Params = { tab?: string; m?: string; sms?: string };
const OLD: Record<string, string> = { messages: 'notifications' };

export default async function Settings({ searchParams }: { searchParams: Promise<Params> }) {
  const s = await requireSession();
  if (!(['settings.payments', 'sms.buy', 'messages.manage', 'team.manage'] as const).some((p) => can(s, p)))
    redirect('/?denied=1');
  const tabs = TABS.filter((t) => t.key === 'club' || t.any.some((p) => can(s, p)));
  const sp = await searchParams;
  const want = OLD[sp.tab ?? ''] ?? sp.tab ?? (sp.sms ? 'sms' : 'club');
  const tab = tabs.find((t) => t.key === want) ?? tabs[0];
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[230px_1fr]">
      <nav
        aria-label="Settings"
        className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-2 shadow-[0_1px_2px_rgba(12,18,32,0.04)] ring-1 ring-[#E7EBF3] lg:sticky lg:top-20 lg:flex-col"
      >
        {tabs.map((t) => {
          const on = t.key === tab?.key;
          const I = t.icon;
          return (
            <Link
              key={t.key}
              href={`/settings?tab=${t.key}`}
              aria-current={on ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-xl px-3.5 py-2.5 text-[14px] font-semibold transition ${on ? 'bg-emerald-50 text-emerald-700' : 'text-ink-500 hover:bg-slate-50 hover:text-ink-900'}`}
            >
              <I size={18} className={on ? 'text-emerald-600' : 'text-ink-300'} />
              {t.label}
            </Link>
          );
        })}
      </nav>
      <section className="min-w-0 rounded-[22px] bg-white p-6 shadow-[0_1px_2px_rgba(12,18,32,0.04)] ring-1 ring-[#E7EBF3] sm:p-8">
        {tab?.key === 'payments' ? (
          <PaymentsTab s={s} />
        ) : tab?.key === 'sms' ? (
          <SmsTab s={s} sms={sp.sms} />
        ) : tab?.key === 'notifications' ? (
          <NotifyTab s={s} m={sp.m} />
        ) : tab?.key === 'team' ? (
          <TeamTab m={sp.m} />
        ) : (
          <ClubTab s={s} />
        )}
      </section>
    </div>
  );
}
