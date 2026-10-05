import { withTenant } from '@lango/db';
import { memberRules } from '@lango/server';
import { Building2, ChevronLeft, ChevronRight, CreditCard, PauseCircle, UserRound, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { SubmitButton } from '@/components/submit-button';
import { date, kes } from '@/lib/format';
import { db } from '@/server/db';
import {
  memberEmergency,
  memberEndPause,
  memberFoundCard,
  memberLostCard,
  memberPhoneConfirm,
  memberPhoneStart,
} from './actions';
import { PauseWizard } from './pause-wizard';

type Who = { tenantId: string; memberId: string };
type Sp = { n?: string; step?: string };

/** Design A screens for phase 2 of member self-service: lost card, pause, my details (5 Oct 2026). */
function Top({ title, sub, back = '/m' }: { title: string; sub?: string; back?: string }) {
  return (
    <header className="mb-4">
      <Link
        href={back}
        className="-ml-1 inline-flex items-center gap-0.5 py-1 text-[13px] font-semibold text-ink-500 hover:text-ink-900"
      >
        <ChevronLeft size={16} /> Back
      </Link>
      <h1 className="mt-2 text-[21px] font-bold leading-tight">{title}</h1>
      {sub && <p className="mt-0.5 text-[13px] leading-relaxed text-ink-500">{sub}</p>}
    </header>
  );
}
const note = (tone: 'ok' | 'warn', text: string) => (
  <p
    className={`mb-4 rounded-xl p-3 text-[13px] ring-1 ${tone === 'ok' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}`}
    role="status"
  >
    {text}
  </p>
);
const big = 'h-[52px] w-full rounded-2xl text-[15px] font-bold text-white transition';

async function load(who: Who) {
  return withTenant(db(), who.tenantId, async (tx) => {
    const [m] = await tx<
      {
        member_no: number;
        phone: string | null;
        blocked: Date | null;
        emergency_name: string | null;
        emergency_phone: string | null;
      }[]
    >`select member_no, phone, cards_blocked_at as blocked, emergency_name, emergency_phone from members where id = ${who.memberId}`;
    const cards = await tx<{ card_code: bigint; revoked: boolean }[]>`
      select card_code, revoked_reason = 'lost' as revoked from credentials
      where member_id = ${who.memberId} and (revoked_at is null or revoked_reason = 'lost') order by card_code`;
    const [pause] = await tx<{ starts_at: Date; ends_at: Date; reason: string }[]>`
      select starts_at, ends_at, reason from member_pauses where member_id = ${who.memberId} and status = 'on' and ends_at > now()
      order by starts_at limit 1`;
    const [end] = await tx<{ ends: Date | null }[]>`
      select max(ends_at) as ends from entitlements where member_id = ${who.memberId} and ends_at > now()`;
    const rules = await memberRules(tx, who.tenantId);
    return { m, cards, pause, end: end?.ends ?? null, rules };
  });
}

export async function MoreMenu({ who }: { who: Who }) {
  const d = await load(who);
  const row = (href: string, icon: React.ReactNode, title: string, sub: string) => (
    <Link href={href} className="flex items-center gap-3 px-4 py-4 hover:bg-[#F7F9FC]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] font-semibold">{title}</b>
        <span className="block text-[12.5px] text-ink-500">{sub}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-ink-400" />
    </Link>
  );
  return (
    <>
      <Top title="More" />
      <div className="divide-y divide-[#EEF1F6] overflow-hidden rounded-2xl border border-[#E4E8EF] bg-white">
        {row(
          '/m?v=card',
          <CreditCard size={19} />,
          d.m?.blocked ? 'My card is blocked' : 'I lost my card',
          d.m?.blocked ? 'Found it? Switch it back on' : 'Block it so no one else can use it',
        )}
        {d.rules.pause.enabled &&
          row(
            '/m?v=pause',
            <PauseCircle size={19} />,
            d.pause ? 'My pause' : 'Pause my membership',
            d.pause
              ? `${date(d.pause.starts_at)} to ${date(new Date(d.pause.ends_at.getTime() - 1))}`
              : 'Travel, illness or exams: keep your days',
          )}
        {d.rules.guest.enabled &&
          row('/m?v=guests', <UsersRound size={19} />, 'Bring a guest', 'Pay a friend’s day pass; they get a code')}
        {row('/m?v=details', <UserRound size={19} />, 'My details', 'Phone number and emergency contact')}
        {row('/m?v=club', <Building2 size={19} />, 'Club information', 'Opening hours, location and contacts')}
      </div>
    </>
  );
}

export async function CardScreen({ who, sp }: { who: Who; sp: Sp }) {
  const d = await load(who);
  const fee = d.rules.card.replaceFeeKes;
  if (d.m?.blocked)
    return (
      <>
        <Top title="Your card is blocked" back="/m?v=more" />
        {sp.n === 'blocked' && note('ok', 'Done. Your card no longer opens any door. We sent you an SMS.')}
        <div className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] leading-relaxed">
          <p>Blocked on {date(d.m.blocked)}. Your days are kept and nothing else changes.</p>
          <p className="mt-2">
            <b>Next:</b> collect a new card at reception
            {fee > 0 ? `. The replacement costs ${kes(fee)}, paid at reception.` : '.'} It works as soon as reception
            links it.
          </p>
        </div>
        <form action={memberFoundCard} className="mt-5">
          <SubmitButton pendingText="Switching it back on…" className={`${big} bg-emerald-600 hover:bg-emerald-700`}>
            I found my card, switch it back on
          </SubmitButton>
        </form>
      </>
    );
  return (
    <>
      <Top title="Lost your card?" sub="Block it now so no one else can use it. Your days are kept." back="/m?v=more" />
      <div className="rounded-2xl border border-[#E4E8EF] bg-white p-4">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">
          {d.cards.length === 1 ? 'Card to block' : 'Cards to block'}
        </div>
        <div className="mt-1 font-mono text-[18px] font-semibold">
          {d.cards.length ? d.cards.map((c) => Number(c.card_code)).join(', ') : '—'}
        </div>
        <ul className="mt-3 grid gap-1.5 text-[13px] text-ink-500">
          <li>· It stops opening every door at once.</li>
          <li>· Collect a new card at reception{fee > 0 ? ` (${kes(fee)})` : ''}.</li>
          <li>· Found it? You can switch it back on here.</li>
        </ul>
      </div>
      {d.cards.length > 0 ? (
        <form action={memberLostCard} className="mt-5">
          <SubmitButton pendingText="Blocking…" className={`${big} bg-rose-600 hover:bg-rose-700`}>
            Block my card now
          </SubmitButton>
        </form>
      ) : (
        <p className="mt-4 text-[13px] text-ink-500">You have no card yet. Reception gives you one.</p>
      )}
      <Link href="/m?v=more" className="mt-2 block py-2 text-center text-[13px] font-semibold text-ink-500">
        Cancel
      </Link>
    </>
  );
}

export async function PauseScreen({ who, sp }: { who: Who; sp: Sp & { e?: string } }) {
  const d = await load(who);
  const r = d.rules.pause;
  if (d.pause) {
    const started = d.pause.starts_at <= new Date();
    return (
      <>
        <Top title={started ? 'You are on a pause' : 'Your pause is booked'} back="/m?v=more" />
        {sp.n === 'paused' && note('ok', 'Done. Your pause is booked and we sent you an SMS.')}
        <div className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] leading-relaxed">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">{d.pause.reason}</div>
          <div className="mt-1 text-[17px] font-bold">
            {date(d.pause.starts_at)} to {date(new Date(d.pause.ends_at.getTime() - 1))}
          </div>
          <p className="mt-1 text-ink-500">
            The doors stay closed for you during the pause. Your plan now ends {date(d.end)}.
          </p>
        </div>
        <form action={memberEndPause} className="mt-5">
          <SubmitButton pendingText="Ending…" className={`${big} bg-emerald-600 hover:bg-emerald-700`}>
            {started ? 'I’m back, end my pause today' : 'Cancel this pause'}
          </SubmitButton>
        </form>
        <p className="mt-2 text-center text-[12.5px] text-ink-500">
          {started ? 'Unused pause days come off your end date.' : 'Your plan goes back to its old end date.'}
        </p>
      </>
    );
  }
  if (!d.end)
    return (
      <>
        <Top title="Pause my membership" back="/m?v=more" />
        <p className="rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] text-ink-500">
          You need an active plan to pause. Renew first, then come back here.
        </p>
      </>
    );
  return (
    <PauseWizard
      minDays={r.minDays}
      maxDays={r.maxDays}
      planEnd={d.end.toISOString()}
      error={sp.e ? decodeURIComponent(sp.e) : null}
    />
  );
}

export async function DetailsScreen({ who, sp }: { who: Who; sp: Sp & { e?: string; p?: string } }) {
  const d = await load(who);
  const shown = (p: string | null) => (p ?? '').replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3');
  const label = 'text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500';
  return (
    <>
      <Top title="My details" back="/m?v=more" />
      {sp.n === 'phone' && note('ok', 'Your phone number is updated. Receipts and reminders now go there.')}
      {sp.n === 'contact' && note('ok', 'Emergency contact saved.')}
      {sp.e && note('warn', decodeURIComponent(sp.e))}

      <section className="rounded-2xl border border-[#E4E8EF] bg-white p-4">
        <div className={label}>Phone number</div>
        {sp.step === 'code' ? (
          <form action={memberPhoneConfirm} className="mt-2 grid gap-3">
            <p className="text-[13px] text-ink-500">
              We sent a 6-digit code to {sp.p ? decodeURIComponent(sp.p) : 'your new number'}. Enter it to confirm.
            </p>
            <input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              placeholder="6-digit code"
              className="input h-12 text-center font-mono text-[20px] tracking-[0.3em]"
            />
            <SubmitButton pendingText="Checking…" className={`${big} bg-emerald-600 hover:bg-emerald-700`}>
              Confirm new number
            </SubmitButton>
            <Link href="/m?v=details" className="text-center text-[13px] font-semibold text-ink-500">
              Cancel
            </Link>
          </form>
        ) : (
          <form action={memberPhoneStart} className="mt-1 grid gap-3">
            <div className="text-[17px] font-semibold tabular-nums">{shown(d.m?.phone ?? null) || '—'}</div>
            <label className="grid gap-1 text-[13px] text-ink-500" htmlFor="phone">
              New number
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                required
                placeholder="07XX XXX XXX"
                className="input h-12 text-[16px]"
              />
            </label>
            <SubmitButton pendingText="Sending code…" className={`${big} bg-emerald-600 hover:bg-emerald-700`}>
              Send me a code
            </SubmitButton>
          </form>
        )}
      </section>

      <section className="mt-4 rounded-2xl border border-[#E4E8EF] bg-white p-4">
        <div className={label}>Emergency contact</div>
        <p className="mt-1 text-[12.5px] text-ink-500">Who the club should call if something happens to you here.</p>
        <form action={memberEmergency} className="mt-3 grid gap-3">
          <label className="grid gap-1 text-[13px] text-ink-500" htmlFor="ename">
            Name
            <input
              id="ename"
              name="name"
              defaultValue={d.m?.emergency_name ?? ''}
              maxLength={80}
              className="input h-12"
            />
          </label>
          <label className="grid gap-1 text-[13px] text-ink-500" htmlFor="ephone">
            Phone
            <input
              id="ephone"
              name="phone"
              type="tel"
              defaultValue={d.m?.emergency_phone ?? ''}
              className="input h-12"
            />
          </label>
          <SubmitButton pendingText="Saving…" className={`${big} bg-[#111827] hover:bg-black`}>
            Save emergency contact
          </SubmitButton>
        </form>
      </section>
      <p className="mt-4 text-center text-[12px] text-ink-500">To change your name, ask at reception.</p>
    </>
  );
}
