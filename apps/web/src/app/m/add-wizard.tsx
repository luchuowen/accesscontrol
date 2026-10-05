'use client';
import { Minus, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { memberPay } from './actions';

export interface WizOption {
  productId: string;
  label: string;
  starts: string;
  price: number;
}
export interface WizService {
  id: string;
  name: string;
  note: string;
  options: WizOption[];
}
type Line = { service: WizService; option: WizOption };

const kes = (n: number) => `KES ${n.toLocaleString('en-KE')}`;

/**
 * "Add a service", design A "One question at a time" (5 Oct 2026): what → how long → the bill. One question per
 * screen with a progress bar and big choices, so members who rarely use apps cannot get lost. The bill can hold
 * several services and is paid with one M-Pesa prompt.
 */
export function AddWizard({
  services,
  phone,
  start,
}: {
  services: WizService[];
  phone: string;
  start: { productId: string } | null;
}) {
  const fromRenew = start
    ? services
        .flatMap((s) => s.options.map((o) => ({ service: s, option: o })))
        .find((l) => l.option.productId === start.productId)
    : undefined;
  const [lines, setLines] = useState<Line[]>(fromRenew ? [fromRenew] : []);
  const [step, setStep] = useState<1 | 2 | 3>(fromRenew ? 3 : 1);
  const [svc, setSvc] = useState<WizService | null>(null);
  const [opt, setOpt] = useState<WizOption | null>(null);
  const total = lines.reduce((a, l) => a + l.option.price, 0);
  const inBill = new Set(lines.map((l) => l.service.id));
  const choices = services.filter((s) => !inBill.has(s.id));

  const pickService = (s: WizService) => {
    setSvc(s);
    setOpt(s.options.length === 1 ? (s.options[0] ?? null) : null);
  };
  const toBill = () => {
    if (!svc || !opt) return;
    setLines((ls) => [...ls.filter((l) => l.service.id !== svc.id), { service: svc, option: opt }]);
    setSvc(null);
    setOpt(null);
    setStep(3);
  };

  const header = (title: string) => (
    <header className="mb-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="text-[12px] text-ink-500">Step {step} of 3</div>
        </div>
        <Link href="/m" className="rounded-lg px-2.5 py-1.5 text-[13px] text-ink-500 hover:text-ink-900">
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

  if (step === 1)
    return (
      <div>
        {header(lines.length ? 'Add another service' : 'Add a service')}
        <h1 className="text-[21px] font-bold leading-tight">What would you like?</h1>
        {choices.length === 0 ? (
          <p className="mt-3 text-[14px] text-ink-500">Everything the club sells is already on your bill.</p>
        ) : (
          <div className="mt-4 grid gap-2.5" role="radiogroup" aria-label="Service">
            {choices.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={svc?.id === s.id}
                onClick={() => pickService(s)}
                className={choice(svc?.id === s.id)}
              >
                <span className={dot(svc?.id === s.id)} />
                <span className="min-w-0 flex-1">
                  <b className="block text-[15px] font-semibold">{s.name}</b>
                  <span className="block text-[12.5px] text-ink-500">{s.note}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <button type="button" disabled={!svc} onClick={() => setStep(2)} className={next}>
          Next
        </button>
        {lines.length > 0 && (
          <button type="button" onClick={() => setStep(3)} className={back}>
            Back to my bill
          </button>
        )}
      </div>
    );

  if (step === 2 && svc)
    return (
      <div>
        {header(lines.length ? 'Add another service' : 'Add a service')}
        <h1 className="text-[21px] font-bold leading-tight">How long do you want {svc.name}?</h1>
        <div className="mt-4 grid gap-2.5" role="radiogroup" aria-label="How long">
          {svc.options.map((o) => (
            <button
              key={o.productId}
              type="button"
              role="radio"
              aria-checked={opt?.productId === o.productId}
              onClick={() => setOpt(o)}
              className={choice(opt?.productId === o.productId)}
            >
              <span className={dot(opt?.productId === o.productId)} />
              <span className="min-w-0 flex-1">
                <b className="block text-[15px] font-semibold">{o.label}</b>
                <span className="block text-[12.5px] text-ink-500">{o.starts}</span>
              </span>
              <span className="shrink-0 text-[15px] font-bold tabular-nums">{kes(o.price)}</span>
            </button>
          ))}
        </div>
        <button type="button" disabled={!opt} onClick={toBill} className={next}>
          Next
        </button>
        <button type="button" onClick={() => setStep(1)} className={back}>
          Back
        </button>
      </div>
    );

  return (
    <form action={memberPay}>
      {header('Your bill')}
      <h1 className="text-[21px] font-bold leading-tight">Check and pay</h1>
      {lines.length === 0 ? (
        <p className="mt-3 text-[14px] text-ink-500">Your bill is empty.</p>
      ) : (
        <div className="mt-4 rounded-2xl border border-[#E4E8EF] bg-white p-4">
          <ul className="grid gap-3">
            {lines.map((l) => (
              <li key={l.service.id} className="flex items-start gap-3">
                <input type="hidden" name="productId" value={l.option.productId} />
                <div className="min-w-0 flex-1">
                  <b className="block text-[14.5px] font-semibold">
                    {l.service.name} · {l.option.label}
                  </b>
                  <span className="block text-[12.5px] text-ink-500">{l.option.starts}</span>
                  <button
                    type="button"
                    onClick={() => setLines((ls) => ls.filter((x) => x.service.id !== l.service.id))}
                    className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-rose-600"
                  >
                    <Minus size={13} /> Remove
                  </button>
                </div>
                <b className="shrink-0 text-[14.5px] tabular-nums">{kes(l.option.price)}</b>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex justify-between border-t border-dashed border-[#DDE3EA] pt-3 text-[17px] font-bold">
            <span>Total</span>
            <span className="tabular-nums">{kes(total)}</span>
          </div>
        </div>
      )}
      {choices.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setSvc(null);
            setOpt(null);
            setStep(1);
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-emerald-700"
        >
          <Plus size={16} /> Add another service
        </button>
      )}
      <div className="mt-4 rounded-xl border border-[#E4E8EF] bg-white px-4 py-3">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">M-Pesa prompt goes to</div>
        <div className="mt-0.5 text-[15px] font-semibold tabular-nums">{phone}</div>
      </div>
      <p className="mt-3 text-[12.5px] leading-relaxed text-ink-500">
        Enter your M-Pesa PIN when the prompt arrives. The doors open on your card as soon as the payment goes through,
        and your receipt comes by SMS.
      </p>
      {lines.length > 0 && (
        <SubmitButton
          pendingText="Sending to your phone…"
          className="mt-5 h-[52px] w-full rounded-2xl bg-emerald-600 text-[15px] font-bold text-white shadow-[0_12px_24px_-12px_rgba(5,150,105,0.7)] transition hover:bg-emerald-700"
        >
          Pay {kes(total)} with M-Pesa
        </SubmitButton>
      )}
    </form>
  );
}
