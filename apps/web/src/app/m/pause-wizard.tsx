'use client';
import Link from 'next/link';
import { useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { memberPause } from './actions';

const REASONS = ['Travel', 'Illness or injury', 'Exams or work', 'Something else'];
const fmt = (d: Date) =>
  d.toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', weekday: 'short', day: 'numeric', month: 'short' });
const iso = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Africa/Nairobi' });
const plus = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Pause, design A "One question at a time": when it starts → how long → why, then the effect before confirming. */
export function PauseWizard({
  minDays,
  maxDays,
  planEnd,
  error,
}: {
  minDays: number;
  maxDays: number;
  planEnd: string;
  error: string | null;
}) {
  const today = new Date();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [start, setStart] = useState<string>(iso(plus(today, 1)));
  const [days, setDays] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const presets = [...new Set([minDays, 7, 14, 21, 30, maxDays])].filter((n) => n >= minDays && n <= maxDays);
  const startDate = new Date(`${start}T00:00:00+03:00`);
  const end = new Date(planEnd);

  const head = (
    <header className="mb-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold">Pause my membership</div>
          <div className="text-[12px] text-ink-500">Step {step} of 3</div>
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
  const dot = (on: boolean) =>
    `h-5 w-5 shrink-0 rounded-full ${on ? 'border-[6px] border-emerald-600' : 'border-2 border-[#CBD3DD]'}`;
  const next =
    'mt-5 grid h-[52px] w-full place-items-center rounded-2xl bg-emerald-600 text-[15px] font-bold text-white transition hover:bg-emerald-700 disabled:bg-[#C9D2DC]';
  const back = 'mt-2 w-full py-2 text-center text-[13px] font-semibold text-ink-500 hover:text-ink-900';
  const err = error && (
    <p className="mb-4 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-800 ring-1 ring-amber-200" role="alert">
      {error}
    </p>
  );

  if (step === 1) {
    const options = [
      { v: iso(plus(today, 1)), label: 'Tomorrow', sub: fmt(plus(today, 1)) },
      { v: iso(plus(today, 7)), label: 'In a week', sub: fmt(plus(today, 7)) },
    ];
    const custom = !options.some((o) => o.v === start);
    return (
      <div>
        {head}
        {err}
        <h1 className="text-[21px] font-bold leading-tight">When does your pause start?</h1>
        <div className="mt-4 grid gap-2.5" role="radiogroup" aria-label="Start">
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={start === o.v}
              onClick={() => setStart(o.v)}
              className={choice(start === o.v)}
            >
              <span className={dot(start === o.v)} />
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-semibold">{o.label}</b>
                <span className="block text-[12.5px] text-ink-500">{o.sub}</span>
              </span>
            </button>
          ))}
          <label className={choice(custom)} htmlFor="pause-start">
            <span className={dot(custom)} />
            <span className="min-w-0 flex-1">
              <b className="block text-[15px] font-semibold">Another day</b>
              <input
                id="pause-start"
                type="date"
                min={iso(plus(today, 1))}
                max={iso(plus(today, 30))}
                value={start}
                onChange={(e) => e.target.value && setStart(e.target.value)}
                className="mt-1 w-full bg-transparent text-[13px] text-ink-700 outline-none"
              />
            </span>
          </label>
        </div>
        <button type="button" onClick={() => setStep(2)} className={next}>
          Next
        </button>
      </div>
    );
  }

  if (step === 2)
    return (
      <div>
        {head}
        <h1 className="text-[21px] font-bold leading-tight">How long is your pause?</h1>
        <p className="mt-1 text-[13px] text-ink-500">
          Between {minDays} and {maxDays} days. Your plan moves later by the same number of days.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5" role="radiogroup" aria-label="Days">
          {presets.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={days === n}
              onClick={() => setDays(n)}
              className={`${choice(days === n)} justify-center`}
            >
              <b className="text-[15px] font-semibold">
                {n} {n === 1 ? 'day' : 'days'}
              </b>
            </button>
          ))}
        </div>
        <button type="button" disabled={!days} onClick={() => setStep(3)} className={next}>
          Next
        </button>
        <button type="button" onClick={() => setStep(1)} className={back}>
          Back
        </button>
      </div>
    );

  const last = plus(startDate, (days ?? 0) - 1);
  const pausedPart = Math.max(0, Math.min(days ?? 0, Math.ceil((end.getTime() - startDate.getTime()) / 86_400_000)));
  const newEnd = plus(end, pausedPart);
  return (
    <form action={memberPause}>
      {head}
      <input type="hidden" name="start" value={start} />
      <input type="hidden" name="days" value={days ?? ''} />
      <input type="hidden" name="reason" value={reason ?? ''} />
      <h1 className="text-[21px] font-bold leading-tight">What is the pause for?</h1>
      <div className="mt-4 grid gap-2.5" role="radiogroup" aria-label="Reason">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={choice(reason === r)}
          >
            <span className={dot(reason === r)} />
            <b className="text-[15px] font-semibold">{r}</b>
          </button>
        ))}
      </div>
      {reason && (
        <div className="mt-5 rounded-2xl border border-[#E4E8EF] bg-white p-4 text-[13.5px] leading-relaxed">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">What happens</div>
          <p className="mt-1">
            The doors stay closed for you <b>{fmt(startDate)}</b> to <b>{fmt(last)}</b>.
          </p>
          <p className="mt-1">
            Your plan ends <b>{fmt(newEnd)}</b> instead of {fmt(end)}.
          </p>
          <p className="mt-1 text-ink-500">Back early? End the pause here and the unused days come off.</p>
        </div>
      )}
      {reason && (
        <SubmitButton
          pendingText="Booking your pause…"
          className="mt-5 h-[52px] w-full rounded-2xl bg-emerald-600 text-[15px] font-bold text-white transition hover:bg-emerald-700"
        >
          Confirm pause
        </SubmitButton>
      )}
      <button type="button" onClick={() => setStep(2)} className={back}>
        Back
      </button>
    </form>
  );
}
