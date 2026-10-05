'use client';
import Link from 'next/link';
import { useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { memberGuest } from './actions';

export type Offer = { productId: string; service: string; price: number };
const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;
const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Nairobi' });
const fmt = (s: string) =>
  new Date(`${s}T12:00:00+03:00`).toLocaleDateString('en-KE', {
    timeZone: 'Africa/Nairobi',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/** Bring a guest, design A: who → what and which day → the bill. The friend gets their code by SMS once paid. */
export function GuestWizard({
  offers,
  phone,
  left,
  error,
}: {
  offers: Offer[];
  phone: string;
  left: number;
  error: string | null;
}) {
  const today = new Date();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [picked, setPicked] = useState<string[]>(offers[0] ? [offers[0].productId] : []);
  const [day, setDay] = useState(iso(today));
  const chosen = offers.filter((o) => picked.includes(o.productId));
  const total = chosen.reduce((a, o) => a + o.price, 0);
  const validPhone = /^(\+?254|0)?\s*[17](\s*\d){8}$/.test(mobile.trim());

  const head = (
    <header className="mb-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold">Bring a guest</div>
          <div className="text-[12px] text-ink-500">
            Step {step} of 3 · {left} {left === 1 ? 'guest pass' : 'guest passes'} left this month
          </div>
        </div>
        <Link href="/m?v=more" className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-500 hover:text-ink-900">
          Cancel
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5" aria-hidden>
        {[1, 2, 3].map((n) => (
          <span key={n} className={`h-1.5 rounded-full ${n <= step ? 'bg-emerald-600' : 'bg-[#DDE3EA]'}`} />
        ))}
      </div>
    </header>
  );
  const choice = (on: boolean) =>
    `flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-4 py-3.5 text-left transition ${on ? 'border-emerald-600 bg-emerald-50' : 'border-[#E4E8EF] bg-white hover:bg-[#F7F9FC]'}`;
  const box = (on: boolean) =>
    `grid h-5 w-5 shrink-0 place-items-center rounded-md text-[12px] font-bold text-white ${on ? 'bg-emerald-600' : 'border-2 border-[#CBD3DD]'}`;
  const dot = (on: boolean) =>
    `h-5 w-5 shrink-0 rounded-full ${on ? 'border-[6px] border-emerald-600' : 'border-2 border-[#CBD3DD]'}`;
  const next =
    'mt-5 grid h-[52px] w-full place-items-center rounded-2xl bg-emerald-600 text-[15px] font-bold text-white transition hover:bg-emerald-700 disabled:bg-[#C9D2DC]';
  const back = 'mt-2 w-full py-2 text-center text-[13px] font-semibold text-ink-500 hover:text-ink-900';

  if (step === 1)
    return (
      <div>
        {head}
        {error && (
          <p className="mb-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200" role="alert">
            {error}
          </p>
        )}
        <h1 className="text-[21px] font-bold leading-tight">Who is your guest?</h1>
        <p className="mt-1 text-[13px] text-ink-500">We text them a code to show at reception.</p>
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-[13px] text-ink-500" htmlFor="gname">
            Their name
            <input
              id="gname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              autoComplete="off"
              className="input h-12 text-[16px]"
            />
          </label>
          <label className="grid gap-1 text-[13px] text-ink-500" htmlFor="gphone">
            Their mobile number
            <input
              id="gphone"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              type="tel"
              inputMode="tel"
              placeholder="07XX XXX XXX"
              className="input h-12 text-[16px]"
            />
          </label>
        </div>
        <button type="button" disabled={!name.trim() || !validPhone} onClick={() => setStep(2)} className={next}>
          Next
        </button>
      </div>
    );

  if (step === 2) {
    const days = [
      { v: iso(today), label: 'Today' },
      { v: iso(new Date(today.getTime() + 86_400_000)), label: 'Tomorrow' },
    ];
    const other = !days.some((d) => d.v === day);
    return (
      <div>
        {head}
        <h1 className="text-[21px] font-bold leading-tight">What and when?</h1>
        <div className="mt-4 grid gap-2.5" role="group" aria-label="Passes">
          {offers.map((o) => {
            const on = picked.includes(o.productId);
            return (
              <button
                key={o.productId}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked((ps) => (on ? ps.filter((x) => x !== o.productId) : [...ps, o.productId]))}
                className={choice(on)}
              >
                <span className={box(on)}>{on ? '✓' : ''}</span>
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px] font-semibold">{o.service}</b>
                  <span className="block text-[12.5px] text-ink-500">Day pass, until 23:59</span>
                </span>
                <span className="shrink-0 text-[15px] font-bold tabular-nums">{kes(o.price)}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">Which day</div>
        <div className="mt-2 grid gap-2.5" role="radiogroup" aria-label="Day">
          {days.map((d) => (
            <button
              key={d.v}
              type="button"
              role="radio"
              aria-checked={day === d.v}
              onClick={() => setDay(d.v)}
              className={choice(day === d.v)}
            >
              <span className={dot(day === d.v)} />
              <b className="flex-1 text-[15px] font-semibold">{d.label}</b>
              <span className="text-[12.5px] text-ink-500">{fmt(d.v)}</span>
            </button>
          ))}
          <label className={choice(other)} htmlFor="gday">
            <span className={dot(other)} />
            <span className="min-w-0 flex-1">
              <b className="block text-[15px] font-semibold">Another day</b>
              <input
                id="gday"
                type="date"
                min={iso(today)}
                max={iso(new Date(today.getTime() + 14 * 86_400_000))}
                value={day}
                onChange={(e) => e.target.value && setDay(e.target.value)}
                className="mt-1 w-full bg-transparent text-[13px] text-ink-700 outline-none"
              />
            </span>
          </label>
        </div>
        <button type="button" disabled={!picked.length} onClick={() => setStep(3)} className={next}>
          Next
        </button>
        <button type="button" onClick={() => setStep(1)} className={back}>
          Back
        </button>
      </div>
    );
  }

  return (
    <form action={memberGuest}>
      {head}
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="phone" value={mobile} />
      <input type="hidden" name="date" value={day} />
      {chosen.map((o) => (
        <input key={o.productId} type="hidden" name="productId" value={o.productId} />
      ))}
      <h1 className="text-[21px] font-bold leading-tight">Check and pay</h1>
      <div className="mt-4 rounded-2xl border border-[#E4E8EF] bg-white p-4">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">Guest</div>
        <div className="mt-0.5 text-[15px] font-semibold">
          {name.trim()} · <span className="tabular-nums">{mobile.trim()}</span>
        </div>
        <div className="mt-0.5 text-[12.5px] text-ink-500">{fmt(day)}, until 23:59</div>
        <ul className="mt-3 grid gap-2 border-t border-[#EEF1F6] pt-3">
          {chosen.map((o) => (
            <li key={o.productId} className="flex justify-between text-[14px]">
              <span>{o.service} · day pass</span>
              <b className="tabular-nums">{kes(o.price)}</b>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-dashed border-[#DDE3EA] pt-3 text-[17px] font-bold">
          <span>Total</span>
          <span className="tabular-nums">{kes(total)}</span>
        </div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
        The M-Pesa prompt goes to your phone ({phone}). Once you pay, {name.trim() || 'your guest'} gets a 6-digit code
        by SMS. They show it at reception and get a wristband.
      </p>
      <SubmitButton
        pendingText="Sending to your phone…"
        className="mt-5 h-[52px] w-full rounded-2xl bg-emerald-600 text-[15px] font-bold text-white transition hover:bg-emerald-700"
      >
        Pay {kes(total)} with M-Pesa
      </SubmitButton>
      <button type="button" onClick={() => setStep(2)} className={back}>
        Back
      </button>
    </form>
  );
}
