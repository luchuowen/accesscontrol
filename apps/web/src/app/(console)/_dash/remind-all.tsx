'use client';
import { Check } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { remindEnding } from '../actions';

function Go() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-[30px] items-center rounded-[9px] bg-[#0B1629] px-3 text-xs font-semibold text-white transition hover:bg-[#11284A] disabled:opacity-60"
    >
      {pending ? 'Sending…' : 'Remind all'}
    </button>
  );
}

/** Queues one renewal SMS to everyone ending in the next 7 days; shows the result in place of the button. */
export function RemindAll() {
  const [state, action] = useActionState(remindEnding, {});
  if (state.done)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <Check size={14} /> {state.done}
      </span>
    );
  return (
    <form action={action}>
      <Go />
    </form>
  );
}
