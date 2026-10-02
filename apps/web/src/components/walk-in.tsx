'use client';
import { Check, Loader2, Radio, Ticket, X } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  bandsNow,
  cancelDayPass,
  dayPassStatus,
  type SaleState,
  sellDayPass,
  visitorHistory,
} from '@/app/(console)/walkin/actions';

/**
 * Walk-in sale, design A "Quick sale modal" (approved 2 Oct 2026): name, mobile, one or more passes, M-Pesa or
 * cash, and a free wristband (tap it on a reader or pick it). The band opens only once paid.
 */
export type WalkinPrice = {
  id: string;
  service: string;
  name: string;
  price_kes: number;
  duration_unit: string;
  duration_count: number;
};
const field =
  'h-11 w-full rounded-[11px] border border-[#E5E8EE] bg-white px-3.5 text-sm text-ink-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-emerald-500/15';
const len = (p: WalkinPrice) =>
  p.duration_unit === 'hour' ? `${p.duration_count} hour${p.duration_count === 1 ? '' : 's'}` : 'Until 23:59';

function Go({ total, channel }: { total: number; channel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || total === 0}
      className="inline-flex h-11 items-center justify-center gap-2 rounded-[11px] bg-[#047857] px-4 text-sm font-semibold text-white transition hover:bg-[#065F46] disabled:opacity-50"
    >
      {pending && <Loader2 size={15} className="animate-spin" />}
      {channel === 'cash' ? 'Record cash' : 'Send M-Pesa prompt'} · KES {total.toLocaleString('en-KE')}
    </button>
  );
}

export function WalkIn({ prices, variant = 'band' }: { prices: WalkinPrice[]; variant?: 'band' | 'outline' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState(0);
  const open = () => {
    setKey((k) => k + 1);
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  return (
    <>
      <button
        type="button"
        onClick={open}
        className={
          variant === 'band'
            ? 'inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-white/20 bg-white/[0.08] px-3.5 text-[13px] font-semibold text-white hover:bg-white/15'
            : 'inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#E5E8EE] bg-white px-3.5 text-sm font-semibold text-ink-900 hover:bg-slate-50'
        }
      >
        <Ticket size={15} /> Walk-in
      </button>
      <dialog
        ref={ref}
        aria-labelledby="walkin-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-full max-w-[800px] overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] open:animate-[pop_.28s_cubic-bezier(.2,.9,.3,1.2)] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none motion-reduce:open:animate-none"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 hover:text-ink-900 max-sm:text-white/80 max-sm:hover:bg-white/10"
        >
          <X size={18} />
        </button>
        {key > 0 && <Sale key={key} prices={prices} onClose={close} onAgain={() => setKey((k) => k + 1)} />}
      </dialog>
    </>
  );
}

function Sale({ prices, onClose, onAgain }: { prices: WalkinPrice[]; onClose: () => void; onAgain: () => void }) {
  const [state, action] = useActionState<SaleState, FormData>(sellDayPass, {});
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [channel, setChannel] = useState<'mpesa' | 'cash'>('mpesa');
  const [bands, setBands] = useState<{ free: number[]; tapped: number | null }>({ free: [], tapped: null });
  const [band, setBand] = useState<number | null>(null);
  const [known, setKnown] = useState<{ visits: number; kes: number } | null>(null);
  const [wait, setWait] = useState<{ status: string; band: number; until: string | null } | null>(null);
  const done = state.done ?? (wait?.status === 'active' ? { band: wait.band, until: wait.until ?? '', name } : null);

  // Free bands, and the band just tapped on a reader (auto-picked), refreshed every 2 s while the form is open.
  useEffect(() => {
    let live = true;
    const tick = () =>
      bandsNow().then((b) => {
        if (!live) return;
        setBands(b);
        setBand((cur) =>
          b.tapped && b.free.includes(b.tapped) ? b.tapped : cur && b.free.includes(cur) ? cur : (b.free[0] ?? null),
        );
      });
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  // Waiting for the visitor to approve the M-Pesa prompt.
  useEffect(() => {
    if (!state.waitingId) return;
    const id = state.waitingId;
    const t = setInterval(() => dayPassStatus(id).then(setWait), 2500);
    dayPassStatus(id).then(setWait);
    return () => clearInterval(t);
  }, [state.waitingId]);

  const chosen = prices.filter((p) => picked.includes(p.id));
  const total = chosen.reduce((a, p) => a + p.price_kes, 0);
  const services = [...new Set(prices.map((p) => p.service))];
  const lookUp = async () => {
    const h = await visitorHistory(phone);
    setKnown(h.visits ? { visits: h.visits, kes: h.kes } : null);
    if (h.name && !name) setName(h.name);
  };

  return (
    <div className="grid sm:grid-cols-[270px_minmax(0,1fr)]">
      <div className="relative flex flex-col gap-4 overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,#163257_0%,#0B1629_60%)] p-6 text-white max-sm:p-5">
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_100%_100%,rgba(16,185,129,0.22),transparent_70%)]" />
        <div className="relative">
          <h2 id="walkin-title" className="text-xl font-semibold tracking-tight">
            Walk-in
          </h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[#A3B3C9]">
            A day pass on a wristband. It opens once paid and stops on its own.
          </p>
        </div>
        <div
          aria-hidden="true"
          className="relative mt-auto flex h-[104px] items-center justify-between gap-3 rounded-[52px] bg-[linear-gradient(135deg,#34D399,#047857_60%,#064E3B)] px-6 shadow-[0_18px_40px_-16px_rgba(16,185,129,0.6),inset_0_1px_0_rgba(255,255,255,0.25)] max-sm:hidden"
        >
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-white/35 bg-white/[0.18] font-mono text-[11.5px] font-bold">
            {done?.band ?? band ?? '—'}
          </span>
          <span className="min-w-0 text-right">
            <b className="block truncate text-[15px]">{name.trim() || 'Visitor'}</b>
            <small className="block truncate text-[10.5px] uppercase tracking-[0.06em] opacity-85">
              {chosen.length ? chosen.map((p) => p.service).join(' + ') : 'Choose passes'}
            </small>
          </span>
        </div>
      </div>

      {done ? (
        <div className="flex flex-col items-center gap-3 p-8 pt-12 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-[#047857] shadow-[0_0_0_8px_rgba(16,185,129,0.08)]">
            <Check size={28} strokeWidth={2.4} />
          </span>
          <h3 className="text-xl font-semibold">
            Give band #{done.band} to {done.name}
          </h3>
          <p className="text-sm text-ink-500">
            Paid. The band opens the doors until {done.until.slice(-5) || 'tonight'}.
          </p>
          <div className="mt-3 flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center rounded-[11px] border border-[#E5E8EE] px-4 text-sm font-semibold hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={onAgain}
              className="inline-flex h-11 items-center rounded-[11px] bg-[#047857] px-4 text-sm font-semibold text-white hover:bg-[#065F46]"
            >
              Next walk-in
            </button>
          </div>
        </div>
      ) : state.waitingId ? (
        <div className="flex flex-col items-center gap-3 p-8 pt-12 text-center">
          {wait && ['failed', 'cancelled', 'expired'].includes(wait.status) ? (
            <>
              <h3 className="text-lg font-semibold">The M-Pesa payment didn’t come through</h3>
              <p className="text-sm text-ink-500">Band #{wait.band} is free again. Try again or take cash.</p>
              <button
                type="button"
                onClick={onAgain}
                className="mt-2 inline-flex h-11 items-center rounded-[11px] bg-ink-900 px-4 text-sm font-semibold text-white"
              >
                Start again
              </button>
            </>
          ) : (
            <>
              <Loader2 size={30} className="animate-spin text-[#047857] motion-reduce:animate-none" />
              <h3 className="text-lg font-semibold">Waiting for {name.split(' ')[0]} to approve on their phone</h3>
              <p className="max-w-sm text-sm text-ink-500">
                KES {total.toLocaleString('en-KE')} to +254 {phone.replace(/^\+?254|^0/, '')}. Band #
                {wait?.band ?? band} opens as soon as the payment is confirmed.
              </p>
              <button
                type="button"
                onClick={async () => {
                  await cancelDayPass(state.waitingId as string);
                  onAgain();
                }}
                className="mt-2 text-sm text-ink-500 hover:text-ink-900"
              >
                Cancel this sale
              </button>
            </>
          )}
        </div>
      ) : (
        <form action={action} className="flex flex-col gap-3.5 p-6 pt-12 max-sm:p-5">
          {state.error && (
            <div
              role="alert"
              className="rounded-[11px] bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 ring-1 ring-rose-200"
            >
              {state.error}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-700">Name</span>
              <input
                name="name"
                required
                autoFocus
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter name"
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-700">Mobile Number</span>
              <span className="flex overflow-hidden rounded-[11px] border border-[#E5E8EE] bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-emerald-500/15">
                <span className="flex items-center whitespace-nowrap border-r border-[#E5E8EE] bg-slate-50 px-3 text-[13.5px] font-semibold text-ink-700">
                  +254
                </span>
                <input
                  name="phone"
                  inputMode="tel"
                  autoComplete="off"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={lookUp}
                  placeholder="Enter mobile number"
                  className="h-11 min-w-0 flex-1 px-3.5 text-sm outline-none placeholder:text-slate-400"
                />
              </span>
            </label>
          </div>
          {known && (
            <div className="rounded-[10px] bg-sky-50 px-3 py-2 text-xs text-sky-800">
              Visit {known.visits + 1} this month · KES {known.kes.toLocaleString('en-KE')} spent so far. A membership
              may suit them.
            </div>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[12.5px] font-semibold text-ink-700">Passes</legend>
            {prices.length === 0 && (
              <p className="text-[13px] text-ink-500">
                No day passes yet. Add a price of hours or 1 day to a service under Services.
              </p>
            )}
            {services.map((sv) => (
              <div key={sv} className="grid grid-cols-2 gap-2">
                {prices
                  .filter((p) => p.service === sv)
                  .map((p) => {
                    const on = picked.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={`flex cursor-pointer flex-col rounded-[13px] border-[1.5px] px-3 py-2.5 ${on ? 'border-brand-500 bg-emerald-50' : 'border-[#E5E8EE] hover:border-slate-300'}`}
                      >
                        <input
                          type="checkbox"
                          name="priceId"
                          value={p.id}
                          checked={on}
                          onChange={(e) =>
                            setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))
                          }
                          className="sr-only"
                        />
                        <b className="text-sm font-semibold">{p.service}</b>
                        <span className="text-xs text-ink-500">
                          {len(p)} · KES {p.price_kes.toLocaleString('en-KE')}
                        </span>
                      </label>
                    );
                  })}
              </div>
            ))}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-semibold text-ink-700">Payment</span>
            <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
              {(['mpesa', 'cash'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  aria-pressed={channel === c}
                  className={`flex-1 rounded-[9px] py-2 text-[13px] font-semibold ${channel === c ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgba(15,23,42,0.1)]' : 'text-ink-500'}`}
                >
                  {c === 'mpesa' ? 'M-Pesa prompt' : 'Cash'}
                </button>
              ))}
            </div>
            <input type="hidden" name="channel" value={channel} />
          </div>
          <label className="flex items-center gap-3 rounded-[13px] border-[1.5px] border-dashed border-[#A7D9C6] bg-[#F7FDFA] px-3 py-2.5">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#CDEFE0] bg-white text-[#047857]">
              <Radio size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] font-semibold">
                {bands.tapped && bands.tapped === band ? `Band ${band} tapped` : 'Wristband'}
              </b>
              <small className="block text-[11.5px] text-ink-500">
                {bands.free.length
                  ? 'Tap a band on any reader, or pick one'
                  : 'No free bands. Add bands under Members → Day passes.'}
              </small>
            </span>
            <select
              name="band"
              aria-label="Wristband number"
              value={band ?? ''}
              onChange={(e) => setBand(Number(e.target.value))}
              className="h-10 rounded-[10px] border border-[#CDEFE0] bg-white px-2 font-mono text-sm font-bold text-[#047857]"
            >
              {bands.free.map((b) => (
                <option key={b} value={b}>
                  #{b}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-1 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center rounded-[11px] border border-[#E5E8EE] bg-white px-4 text-sm font-semibold hover:bg-slate-50"
            >
              Cancel
            </button>
            <Go total={total} channel={channel} />
          </div>
        </form>
      )}
    </div>
  );
}
