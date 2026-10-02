import { withTenant } from '@lango/db';
import { can, type NotifySettings, quietHours } from '@lango/server';
import {
  Bell,
  CalendarClock,
  HandCoins,
  Heart,
  MonitorSmartphone,
  Moon,
  Phone,
  Receipt,
  ShieldAlert,
  Sunrise,
  UserPlus,
  Wallet,
} from 'lucide-react';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { saveNotifications } from './actions';
import { Banner, Group, type Note, Row, SectionHead, Switch } from './bits';

const NOTES: Record<string, Note> = {
  saved: ['green', 'Saved.'],
  forbidden: ['red', 'Only the owner or a manager can change this.'],
  'alert-phone': ['red', 'Add the alert phone: the daily summary and automatic top-up go to it.'],
};
const hours = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const small = 'input inline-block w-16 px-2 py-1 text-center tabular-nums';

/** Settings › Notifications: what the club sends automatically, to members and to staff, and quiet hours. */
export async function NotifyTab({ s, m }: { s: Session; m?: string }) {
  const [row] = await withTenant(
    db(),
    s.tid,
    (tx) =>
      tx<
        { n: NotifySettings | null }[]
      >`select data->'notifications' as n from tenant_settings where tenant_id = ${s.tid}`,
  );
  const n = row?.n ?? {};
  const q = quietHours(n);
  const owner = can(s, 'messages.manage');
  return (
    <form action={saveNotifications}>
      <SectionHead
        icon={Bell}
        title="Notifications"
        sub="What the club sends by SMS. One non-urgent message per member a day."
        action={
          <span className="flex items-center gap-2.5 text-[13px] font-semibold">
            SMS on <Switch name="enabled" on={!!n.enabled} label="Send SMS from this club" />
          </span>
        }
      />
      <Banner note={m ? NOTES[m] : undefined} />
      <fieldset disabled={!owner} className="contents">
        <Group title="To members">
          <Row icon={Receipt} label="Payment receipt" hint="With the new end date">
            <Switch name="receipts" on={n.receipts !== false} label="Payment receipt" />
          </Row>
          <Row icon={HandCoins} label="“Payment received”" hint="When an M-Pesa payment needs matching">
            <Switch name="unmatched" on={n.unmatched !== false} label="Payment received note" />
          </Row>
          <Row
            icon={CalendarClock}
            label={
              <>
                Renewal reminder{' '}
                <input
                  name="reminderDays"
                  type="number"
                  min={1}
                  max={14}
                  defaultValue={n.reminderDays ?? 3}
                  aria-label="Days before"
                  className={small}
                />{' '}
                days before
              </>
            }
            hint="And on the last day"
          >
            <Switch name="reminders" on={n.reminders !== false} label="Renewal reminder" />
          </Row>
          <Row icon={UserPlus} label="Welcome" hint="With the member number, for members added by staff">
            <Switch name="welcome" on={n.welcome !== false} label="Welcome" />
          </Row>
          <Row icon={Heart} label="“We miss you”" hint="Once, a week after a plan ends">
            <Switch name="winback" on={n.winback !== false} label="We miss you" />
          </Row>
        </Group>

        <Group title="To staff">
          <Row icon={Phone} label="Alert phone">
            <input
              name="alertPhone"
              inputMode="tel"
              defaultValue={n.alertPhone ?? ''}
              placeholder="07…"
              className="input w-40 py-1.5"
            />
          </Row>
          <Row icon={MonitorSmartphone} label="Door PC offline" hint="After 15 minutes, and when back">
            <Switch name="bridgeAlerts" on={n.bridgeAlerts !== false} label="Door PC offline" />
          </Row>
          <Row icon={ShieldAlert} label="Changes made at the door PC">
            <Switch name="tamperAlerts" on={n.tamperAlerts !== false} label="Changes at the door PC" />
          </Row>
          <Row icon={Sunrise} label="Daily summary at 19:00" hint="Payments, new members, entries">
            <Switch name="dailySummary" on={!!n.dailySummary} label="Daily summary" />
          </Row>
          <Row
            icon={Wallet}
            label={
              <>
                Low credit below{' '}
                <input
                  name="lowBalance"
                  type="number"
                  min={0}
                  defaultValue={n.lowBalance ?? 100}
                  aria-label="SMS"
                  className={small}
                />{' '}
                SMS
              </>
            }
            hint={
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Then top up automatically with KES
                <MoneyInput
                  name="autoTopupKes"
                  prefix={false}
                  defaultValue={n.autoTopupKes ?? 1000}
                  className="inline-flex h-7 w-20"
                />
              </span>
            }
          >
            <Switch name="autoTopup" on={!!n.autoTopup} label="Automatic top-up" />
          </Row>
        </Group>

        <Group title="Quiet hours">
          <Row icon={Moon} label="No messages between" hint="Receipts and sign-in codes still go">
            <span className="flex items-center gap-2 font-normal">
              <select name="quietFrom" defaultValue={q.from} aria-label="From" className="input w-24 py-1.5">
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
              –
              <select name="quietTo" defaultValue={q.to} aria-label="To" className="input w-24 py-1.5">
                {hours.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </span>
          </Row>
        </Group>
      </fieldset>
      {owner ? (
        <div className="mt-6 flex justify-end">
          <SubmitButton pendingText="Saving…" className="btn-primary">
            Save
          </SubmitButton>
        </div>
      ) : (
        <p className="mt-5 text-[12.5px] text-ink-500">The owner or a manager can change these.</p>
      )}
    </form>
  );
}
