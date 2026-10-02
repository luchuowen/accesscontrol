'use client';
import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type AddStaffState, addStaff } from './actions';

export function AddStaffForm() {
  const [state, action] = useActionState<AddStaffState, FormData>(addStaff, {});
  return (
    <form action={action} className="mt-4 space-y-3 border-t border-ink-100 pt-4">
      {state.error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{state.error}</div>
      )}
      {state.done && (
        <div
          className={`rounded-xl p-3 text-sm ring-1 ${state.done.emailed ? 'bg-emerald-50/60 ring-emerald-100' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {state.done.emailed ? (
            <>
              Invitation sent to <b>{state.done.name}</b> at {state.done.email}. The link works for 7 days.
            </>
          ) : (
            <>Added, but the email did not go out. Use “Resend” next to their name.</>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" required placeholder="Full name" className="input" />
        <input name="email" type="email" required placeholder="Email" className="input" />
        <input name="phone" type="tel" inputMode="tel" placeholder="Mobile (optional)" className="input" />
        <select name="role" defaultValue="reception" className="input">
          <option value="reception">Front desk</option>
          <option value="manager">Manager</option>
          <option value="accountant">Accountant</option>
          <option value="owner">Owner</option>
        </select>
      </div>
      <SubmitButton pendingText="Sending…" className="btn-ghost w-full">
        Send invitation
      </SubmitButton>
    </form>
  );
}
