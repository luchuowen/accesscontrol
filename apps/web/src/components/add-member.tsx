'use client';
import { Plus, X } from 'lucide-react';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { addMember } from '@/app/(console)/actions';

/**
 * Add member modal, design B "Live member card" (approved 2 Oct 2026): a membership card on the left fills in as the
 * fields are typed. Centred dialog on desktop, bottom sheet on phones. Esc, ✕ or a click outside closes it.
 */
const field =
  'h-11 w-full rounded-[11px] border border-[#E5E8EE] bg-white px-3.5 text-sm text-ink-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-4 focus:ring-emerald-500/15';

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-[11px] bg-[#047857] px-4 text-sm font-semibold text-white transition hover:bg-[#065F46] disabled:opacity-60"
    >
      {pending ? 'Adding…' : 'Add member'}
    </button>
  );
}

const spaced = (d: string) => d.replace(/(\d{3})(\d{0,3})(\d{0,3})/, '$1 $2 $3').trim();

export function AddMember({
  club,
  nextNo,
  variant = 'band',
}: {
  club: string;
  nextNo: number;
  variant?: 'band' | 'primary';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(addMember, {});
  const [v, setV] = useState({ first: '', last: '', phone: '', no: '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  // Open straight away when the page is reached with ?add=1 (e.g. from the old "New member" link).
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get('add') === '1' ||
      new URLSearchParams(window.location.search).get('new') === '1'
    )
      ref.current?.showModal();
  }, []);

  const open = () => {
    setV({ first: '', last: '', phone: '', no: '' });
    ref.current?.showModal();
  };
  const close = () => ref.current?.close();
  const name = [v.first.trim(), v.last.trim()].filter(Boolean).join(' ');
  const digits = v.phone.replace(/\D/g, '').replace(/^254/, '').replace(/^0/, '');

  return (
    <>
      {variant === 'band' ? (
        <button
          type="button"
          onClick={open}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-white px-3.5 text-[13px] font-semibold text-ink-950 hover:bg-slate-100"
        >
          <Plus size={15} /> Member
        </button>
      ) : (
        <button type="button" onClick={open} className="btn-primary">
          <Plus size={16} /> New member
        </button>
      )}

      <dialog
        ref={ref}
        aria-labelledby="add-member-title"
        onClick={(e) => e.target === ref.current && close()}
        className="m-auto w-full max-w-[760px] overflow-hidden rounded-[20px] bg-white p-0 text-ink-900 shadow-[0_30px_80px_-20px_rgba(11,22,41,0.55)] backdrop:bg-[#0B1629]/45 backdrop:backdrop-blur-[3px] open:animate-[pop_.28s_cubic-bezier(.2,.9,.3,1.2)] max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none motion-reduce:open:animate-none"
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-[10px] text-ink-500 hover:bg-slate-100 hover:text-ink-900 max-sm:text-white/80 max-sm:hover:bg-white/10 max-sm:hover:text-white"
        >
          <X size={18} />
        </button>
        <div className="grid sm:grid-cols-[300px_minmax(0,1fr)]">
          <div className="relative flex flex-col gap-5 overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,#163257_0%,#0B1629_60%)] p-6 text-white max-sm:p-5">
            <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_100%_100%,rgba(16,185,129,0.22),transparent_70%)]" />
            <div className="relative">
              <h2 id="add-member-title" className="text-xl font-semibold tracking-tight">
                New member
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#A3B3C9]">
                Their number is their card code and their M-Pesa account number.
              </p>
            </div>
            <div
              aria-hidden="true"
              className="relative mt-auto flex aspect-[1.586] w-full max-w-[300px] flex-col justify-between overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#10B981_0%,#047857_55%,#064E3B_100%)] px-[18px] py-4 shadow-[0_18px_40px_-16px_rgba(16,185,129,0.6),inset_0_1px_0_rgba(255,255,255,0.25)] max-sm:hidden"
            >
              <span className="absolute -right-10 -top-10 h-40 w-40 rounded-full border-[24px] border-white/[0.08]" />
              <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] opacity-85">{club}</div>
              <div>
                <div className="min-h-[22px] truncate text-[17px] font-semibold">{name || 'New Member'}</div>
                <div className="font-mono text-[22px] tracking-[0.12em]">{v.no.trim() || nextNo}</div>
              </div>
              <div className="flex justify-between text-[10.5px] uppercase tracking-[0.06em] opacity-80">
                <span>Member</span>
                <span>{digits ? `+254 ${spaced(digits)}` : '+254 ··· ··· ···'}</span>
              </div>
            </div>
          </div>

          <form action={action} className="flex flex-col gap-3.5 p-6 pt-12 max-sm:p-5">
            {state.error && (
              <div
                role="alert"
                className="rounded-[11px] bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 ring-1 ring-rose-200"
              >
                {state.error}
              </div>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-700">First Name</span>
              <input
                name="firstName"
                value={v.first}
                required
                autoFocus
                maxLength={80}
                placeholder="Enter first name"
                className={field}
                onChange={set('first')}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-700">Last Name</span>
              <input
                name="lastName"
                value={v.last}
                required
                maxLength={80}
                placeholder="Enter last name"
                className={field}
                onChange={set('last')}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-semibold text-ink-700">Mobile Number</span>
              <span className="flex overflow-hidden rounded-[11px] border border-[#E5E8EE] bg-white transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-emerald-500/15">
                <span className="flex items-center whitespace-nowrap border-r border-[#E5E8EE] bg-slate-50 px-3 text-[13.5px] font-semibold text-ink-700">
                  +254
                </span>
                <input
                  name="phone"
                  value={v.phone}
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="Enter mobile number"
                  className="h-11 min-w-0 flex-1 px-3.5 text-sm outline-none placeholder:text-slate-400"
                  onChange={set('phone')}
                />
              </span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between text-[12.5px] font-semibold text-ink-700">
                Member Number
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-[#047857]">
                  Auto
                </span>
              </span>
              <input
                name="memberNo"
                value={v.no}
                type="number"
                min={1}
                max={65535}
                placeholder={String(nextNo)}
                className={field}
                onChange={set('no')}
              />
            </label>
            <div className="mt-1.5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={close}
                className="inline-flex h-11 items-center rounded-[11px] border border-[#E5E8EE] bg-white px-4 text-sm font-semibold hover:bg-slate-50"
              >
                Cancel
              </button>
              <Save />
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
