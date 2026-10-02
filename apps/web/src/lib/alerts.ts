import type { LiveSession } from '@lango/server';
import { can } from '@lango/server';
import type { Alert } from '@/components/topbar';
import { consoleAlerts } from '@/lib/data';
import { ago, kes } from '@/lib/format';

/** Bell items for this login, shown only where the role can act on them. */
export async function alertsFor(s: LiveSession): Promise<Alert[]> {
  const a = await consoleAlerts(s.tid);
  const doors = can(s, 'doors.manage') ? '/access' : undefined;
  const out: (Alert | false)[] = [
    a.unmatched > 0 &&
      can(s, 'payments.assign') && {
        tone: 'red',
        text: `${a.unmatched} payment${a.unmatched > 1 ? 's' : ''} not matched`,
        meta: kes(a.unmatchedKes),
        href: '/payments',
      },
    (!a.bridgeLastSeen || Date.now() - a.bridgeLastSeen.getTime() > 10 * 60_000) && {
      tone: 'amber',
      text: a.bridgeLastSeen ? `Door PC offline ${ago(a.bridgeLastSeen)}` : 'Door PC not connected',
      href: doors,
    },
    a.syncFailed > 0 && {
      tone: 'red',
      text: `${a.syncFailed} door update${a.syncFailed > 1 ? 's' : ''} failed`,
      href: doors,
    },
    a.smsUnits < 100 && {
      tone: 'amber',
      text: 'SMS credit low',
      meta: `${a.smsUnits} left`,
      href: can(s, 'sms.buy') ? '/settings' : undefined,
    },
  ];
  return out.filter((x): x is Alert => !!x);
}
