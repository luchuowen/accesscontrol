import { withTenant } from '@lango/db';
import { can, memberRules } from '@lango/server';
import { CalendarRange, Clock, CreditCard, MapPin, PauseCircle, Phone, Smartphone, UsersRound } from 'lucide-react';
import { MoneyInput } from '@/components/money-input';
import { SubmitButton } from '@/components/submit-button';
import type { Session } from '@/lib/session';
import { db } from '@/server/db';
import { saveMemberRules } from './actions';
import { Banner, Group, type Note, Row, SectionHead, Switch } from './bits';

const NOTES: Record<string, Note> = {
  saved: ['green', 'Saved. Members see the new rules straight away.'],
  forbidden: ['red', 'Only the owner or a manager can change this.'],
};
const small = 'input inline-block w-16 px-2 py-1 text-center tabular-nums';

/** Settings › Member app: what members may do for themselves on their phone (pause rules, lost-card fee). */
export async function MemberAppTab({ s, m }: { s: Session; m?: string }) {
  const r = await withTenant(db(), s.tid, (tx) => memberRules(tx, s.tid));
  const owner = can(s, 'members.edit');
  return (
    <form action={saveMemberRules}>
      <SectionHead
        icon={Smartphone}
        title="Member app"
        sub="What members can do on their phone without coming to reception. Every change is recorded and confirmed to them by SMS."
      />
      <Banner note={m ? NOTES[m] : undefined} />
      <fieldset disabled={!owner} className="contents">
        <Group title="Pause">
          <Row icon={PauseCircle} label="Members can pause their membership" hint="Approved at once within these rules">
            <Switch name="pause" on={r.pause.enabled} label="Members can pause" />
          </Row>
          <Row
            icon={CalendarRange}
            label={
              <>
                A pause is{' '}
                <input
                  name="minDays"
                  type="number"
                  min={1}
                  max={90}
                  defaultValue={r.pause.minDays}
                  aria-label="Shortest"
                  className={small}
                />{' '}
                to{' '}
                <input
                  name="maxDays"
                  type="number"
                  min={1}
                  max={180}
                  defaultValue={r.pause.maxDays}
                  aria-label="Longest"
                  className={small}
                />{' '}
                days
              </>
            }
            hint={
              <>
                At most{' '}
                <input
                  name="perYear"
                  type="number"
                  min={1}
                  max={365}
                  defaultValue={r.pause.perYear}
                  aria-label="Per year"
                  className={small}
                />{' '}
                days in a year · starts from tomorrow, up to 30 days ahead
              </>
            }
          >
            <span />
          </Row>
        </Group>
        <Group title="Lost card">
          <Row
            icon={CreditCard}
            label="Replacement card fee"
            hint="Members block a lost card themselves at once. The fee is shown to them and paid at reception; 0 = free."
          >
            <MoneyInput name="replaceFeeKes" defaultValue={r.card.replaceFeeKes} className="inline-flex h-9 w-32" />
          </Row>
        </Group>
        <Group title="Guests">
          <Row
            icon={UsersRound}
            label={
              <>
                Members can buy a guest pass, up to{' '}
                <input
                  name="guestPerMonth"
                  type="number"
                  min={1}
                  max={31}
                  defaultValue={r.guest.perMonth}
                  aria-label="Guest passes a month"
                  className={small}
                />{' '}
                a month
              </>
            }
            hint="Priced at your walk-in day passes. The guest gets a code by SMS; reception hands a day wristband."
          >
            <Switch name="guest" on={r.guest.enabled} label="Members can buy guest passes" />
          </Row>
        </Group>
        <Group title="Club information members see">
          <Row icon={Clock} label="Opening hours" hint="One line per day or group of days">
            <textarea
              name="hours"
              rows={3}
              defaultValue={r.info.hours}
              placeholder={'Mon–Fri 5:30–22:00\nSat–Sun 7:00–20:00'}
              className="input w-72 py-2 text-[13px]"
            />
          </Row>
          <Row icon={MapPin} label="Location">
            <input
              name="address"
              defaultValue={r.info.address}
              placeholder="Karura Rd, Nairobi"
              className="input w-72 py-1.5"
            />
          </Row>
          <Row icon={Phone} label="Club phone">
            <input
              name="clubPhone"
              inputMode="tel"
              defaultValue={r.info.phone}
              placeholder="07…"
              className="input w-40 py-1.5"
            />
          </Row>
        </Group>
      </fieldset>
      {owner && (
        <div className="mt-6 flex justify-end">
          <SubmitButton pendingText="Saving…" className="btn-primary">
            Save
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
