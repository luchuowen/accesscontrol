'use client';
import { Check, Send } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { remindEnding } from '../actions';

function Go({ label, light }: { label: string; light?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        light
          ? 'inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-[#0B1629] transition hover:bg-slate-100 disabled:opacity-60'
          : 'inline-flex h-[30px] items-center rounded-[9px] bg-[#0B1629] px-3 text-xs font-semibold text-white transition hover:bg-[#11284A] disabled:opacity-60'
      }
    >
      {light && <Send size={14} />}
      {pending ? 'Sending…' : label}
    </button>
  );
}

/** Queues one renewal SMS to everyone ending in the next 7 days; shows the result in place of the button. */
export function RemindAll({ label = 'Remind all', light }: { label?: string; light?: boolean }) {
  const [state, action] = useActionState(remindEnding, {});
  if (state.done)
    return (
      <span
        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${light ? 'h-10 text-[#7EE2B8]' : 'text-emerald-700'}`}
      >
        <Check size={14} /> {state.done}
      </span>
    );
  return (
    <form action={action}>
      <Go label={label} light={light} />
    </form>
  );
}
