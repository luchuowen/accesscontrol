import type { LiveSession } from '@lango/server';
import { can } from '@lango/server';
import { consoleAlerts } from '@/lib/data';
import { ago, kes } from '@/lib/format';

/**
 * Club health (drawer design C, approved 3 Oct 2026). Notifications follow the signed-in person's permissions: an
 * area shows only to people who can act in it, and each item opens the page where it is fixed.
 *   Money    payments to match (payments.assign) · Payment Gateway not set up (settings.payments)
 *   Doors    door PC offline, door updates failed (doors.manage) · edits made at the door PC (club.own)
 *   Members  plans ending this week, paid members not seen 21+ days (messages.manage)
 *   Messages SMS credit out or low (sms.buy) · messages waiting for a reply (inbox.reply)
 */
export type HealthIcon = 'money' | 'card' | 'door' | 'alert' | 'users' | 'away' | 'sms' | 'chat';
export interface HealthItem {
  id: string;
  tone: 'red' | 'amber' | 'blue';
  icon: HealthIcon;
  title: string;
  sub: string;
  href: string;
  action: string;
}
export interface HealthArea {
  name: 'Money' | 'Doors' | 'Members' | 'Messages';
  items: HealthItem[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function clubHealth(s: LiveSession): Promise<HealthArea[]> {
  const a = await consoleAlerts(s.tid);
  const areas: HealthArea[] = [];
  const add = (name: HealthArea['name'], show: boolean, items: (HealthItem | false)[]) => {
    if (show) areas.push({ name, items: items.filter((x): x is HealthItem => !!x) });
  };

  add('Money', can(s, 'payments.assign') || can(s, 'settings.payments'), [
    a.unmatched > 0 &&
      can(s, 'payments.assign') && {
        id: 'unmatched',
        tone: 'red',
        icon: 'money',
        title: `${plural(a.unmatched, 'payment')} need${a.unmatched === 1 ? 's' : ''} matching`,
        sub: `${kes(a.unmatchedKes)} paid, but the account number matched no member. Nobody got access yet.`,
        href: '/payments#sort',
        action: 'Match',
      },
    !a.gateway &&
      can(s, 'settings.payments') && {
        id: 'gateway',
        tone: 'blue',
        icon: 'card',
        title: 'Payment Gateway not connected',
        sub: 'NAVAC connects it during setup. Until then members pay cash at the desk.',
        href: '/settings?tab=payments',
        action: 'See',
      },
  ]);

  const offline = !a.bridgeLastSeen || Date.now() - a.bridgeLastSeen.getTime() > 10 * 60_000;
  add('Doors', can(s, 'doors.manage') || can(s, 'club.own'), [
    offline &&
      can(s, 'doors.manage') && {
        id: 'bridge',
        tone: a.bridgeLastSeen ? 'red' : 'amber',
        icon: 'door',
        title: a.bridgeLastSeen ? `Door PC offline since ${ago(a.bridgeLastSeen)}` : 'Door PC not connected yet',
        sub: a.bridgeLastSeen
          ? 'Doors keep working with the last update. New payments reach the doors when it is back.'
          : 'Your installer connects it. Until then, payments are recorded but doors are not updated.',
        href: '/access',
        action: 'See doors',
      },
    a.syncFailed > 0 &&
      can(s, 'doors.manage') && {
        id: 'sync',
        tone: 'red',
        icon: 'alert',
        title: `${plural(a.syncFailed, 'member’s', 'members’')} door access did not update`,
        sub: `${a.syncWho ?? 'A member'}${a.syncFailed > 1 ? ` and ${a.syncFailed - 1} more` : ''}: the door PC refused the change. It retries every minute.`,
        href: a.syncFailed === 1 && a.syncMemberId ? `/members/${a.syncMemberId}` : '/access',
        action: 'Open',
      },
    a.tamper > 0 &&
      can(s, 'club.own') && {
        id: 'tamper',
        tone: 'amber',
        icon: 'alert',
        title: `${plural(a.tamper, 'change')} made at the door PC this week`,
        sub: `Latest: ${a.tamperWho ?? 'a member'}. Lango put their access back. Changes made in AxTraxNG don’t stick.`,
        href: '/access',
        action: 'Details',
      },
  ]);

  add('Members', can(s, 'messages.manage'), [
    a.ending > 0 && {
      id: 'ending',
      tone: 'amber',
      icon: 'users',
      title: `${plural(a.ending, 'plan')} end${a.ending === 1 ? 's' : ''} this week`,
      sub: `${kes(a.endingKes)} due if they renew. ${a.endingWho ?? ''} ends ${a.endingDays !== null && a.endingDays <= 1 ? 'tomorrow' : `in ${a.endingDays} days`}.`,
      href: '/members?f=ending',
      action: 'See list',
    },
    a.away > 0 && {
      id: 'away',
      tone: 'amber',
      icon: 'away',
      title: `${plural(a.away, 'paid member')} not seen in 21+ days`,
      sub: 'The clearest early sign someone will not renew. A quick message helps.',
      href: '/',
      action: 'See who',
    },
  ]);

  add('Messages', can(s, 'sms.buy') || can(s, 'inbox.reply'), [
    a.smsOn &&
      a.smsUnits < a.smsLow &&
      can(s, 'sms.buy') && {
        id: 'sms',
        tone: a.smsUnits <= 0 ? 'red' : 'amber',
        icon: 'sms',
        title: a.smsUnits <= 0 ? 'SMS credit is out' : 'SMS credit is low',
        sub:
          a.smsUnits <= 0
            ? '0 SMS left. Receipts and reminders are paused until you top up.'
            : `${a.smsUnits.toLocaleString('en-KE')} SMS left, below your alert level of ${a.smsLow.toLocaleString('en-KE')}.`,
        href: '/settings?tab=messages',
        action: 'Top up',
      },
    a.waiting > 0 &&
      can(s, 'inbox.reply') && {
        id: 'chat',
        tone: 'blue',
        icon: 'chat',
        title: `${plural(a.waiting, 'message')} waiting for a reply`,
        sub: `${a.waitingWho ?? 'Someone'}${a.waitingChannel === 'whatsapp' ? ' on WhatsApp' : a.waitingChannel === 'email' ? ' by email' : ''}: “${(a.waitingBody ?? '').slice(0, 80)}${(a.waitingBody ?? '').length > 80 ? '…' : ''}”`,
        href: a.waiting === 1 && a.waitingId ? `/communications?c=${a.waitingId}` : '/communications?f=waiting',
        action: 'Reply',
      },
  ]);
  return areas;
}
