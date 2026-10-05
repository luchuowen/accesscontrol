'use client';
import type { GuestLookup } from '@lango/server';
import { CheckCircle2, Loader2, UserCheck, X } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { bandsNow, handOverGuest, lookupGuest } from '@/app/(console)/walkin/actions';

/**
 * Reception: a guest arrives with the code a member bought them. Type the code (or their phone), check the name, pick
 * a free day wristband and hand it over. The band opens the paid areas until 23:59, then stops by itself.
 */
export function GuestCheckIn({ variant = 'outline' }: { variant?: 'band' | 'outline' }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [g, setG] = useState<GuestLookup | null | 'none'>(null);
  const [bands, setBands] = useState<number[]>([]);
  const [band, setBand] = useState<number | null>(null);
  const [done, setDone] = useState<{ band: number; until: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = () => {
    setQ('');
    setG(null);
    setBand(null);
    setDone(null);
    setErr(null);
    ref.current?.showModal();
  };
  const find = () =>
    start(async () => {
      setErr(null);
      const r = await lookupGuest(q);
      setG(r ?? 'none');
      if (r?.status === 'paid') {
        const b = await bandsNow();
        setBands(b.free);
        setBand(b.tapped && b.free.includes(b.tapped) ? b.tapped : (b.free[0] ?? null));
      }
    });
  const give = () =>
    start(async () => {
      if (!g || g === 'none' || band === null) return;
      const r = await handOverGuest(g.id, band);
      if (r.ok) setDone({ band: r.band, until: r.until });
      else setErr(r.why);
    });
  const status: Record<string, string> = {
    used: 'This code was already used.',
    'wrong-day': 'This pass is for another day.',
    unpaid: 'This pass is not paid yet. Ask the member to complete the M-Pesa payment.',
  };
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
        <UserCheck size={15} /> Guest with a code
      </button>
      <dialog
        ref={ref}
        aria-labelledby="guest-title"
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-full max-w-[460px] overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none"
      >
        <div className="relative p-6">
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
          <h2 id="guest-title" className="text-[18px] font-semibold">
            Guest with a code
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-500">
            A member paid for their day pass. Check the code, hand a wristband.
          </p>

          {done ? (
            <div className="mt-5 rounded-2xl bg-emerald-50 p-5 text-emerald-900 ring-1 ring-emerald-200" role="status">
              <CheckCircle2 size={26} className="text-emerald-600" />
              <div className="mt-2 text-[17px] font-semibold">Give wristband {done.band}</div>
              <div className="text-[13.5px]">It opens their areas now, until {done.until} tonight.</div>
              <button type="button" onClick={open} className="btn-ghost mt-4 h-9 bg-white">
                Next guest
              </button>
            </div>
          ) : (
            <>
              <form
                className="mt-5 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  find();
                }}
              >
                <input
                  id="guest-code"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Code (482 917) or their phone"
                  inputMode="numeric"
                  autoComplete="off"
                  className="input h-11 min-w-0 flex-1 text-[15px] tracking-[0.06em]"
                />
                <button
                  type="submit"
                  disabled={pending || q.replace(/\D/g, '').length < 6}
                  className="btn-primary h-11 px-4"
                >
                  {pending && !g ? <Loader2 size={15} className="animate-spin" /> : 'Find'}
                </button>
              </form>
              {g === 'none' && <p className="mt-3 text-[13px] text-rose-700">No guest pass with that code or phone.</p>}
              {g && g !== 'none' && (
                <div className="mt-4 rounded-2xl border border-[#E4E8EF] p-4">
                  <div className="text-[16px] font-semibold">{g.guestName}</div>
                  <div className="text-[13px] text-ink-500">
                    {g.what} · guest of {g.host} (#{g.hostNo})
                  </div>
                  {g.status !== 'paid' ? (
                    <p className="mt-3 text-[13px] font-semibold text-amber-800">{status[g.status]}</p>
                  ) : (
                    <>
                      <div className="mt-4 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-500">
                        Wristband to hand over
                      </div>
                      {bands.length === 0 ? (
                        <p className="mt-1 text-[13px] text-rose-700">
                          No free wristbands. Add more under Members › Day passes.
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {bands.slice(0, 12).map((b) => (
                            <button
                              key={b}
                              type="button"
                              onClick={() => setBand(b)}
                              aria-pressed={band === b}
                              className={`h-9 rounded-lg px-3 font-mono text-[13.5px] font-semibold ring-1 ${band === b ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-white ring-[#D5DBE5] hover:bg-slate-50'}`}
                            >
                              {b}
                            </button>
                          ))}
                        </div>
                      )}
                      {err && <p className="mt-3 text-[13px] text-rose-700">{err}</p>}
                      <button
                        type="button"
                        onClick={give}
                        disabled={pending || band === null}
                        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[11px] bg-[#047857] text-sm font-semibold text-white hover:bg-[#065F46] disabled:opacity-50"
                      >
                        {pending && <Loader2 size={15} className="animate-spin" />}
                        Hand over wristband {band ?? ''}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
