'use client';
import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type AddPartnerState, addPartner } from '../actions';

export function AddPartnerForm() {
  const [state, action] = useActionState<AddPartnerState, FormData>(addPartner, {});
  return (
    <form action={action} className="mt-4 space-y-3">
      {state.error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{state.error}</div>
      )}
      {state.done && (
        <div
          className={`rounded-xl p-3 text-sm ring-1 ${state.done.emailed ? 'bg-emerald-50/60 ring-emerald-100' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {state.done.emailed ? (
            <>
              Invitation sent to <b>{state.done.name}</b> at {state.done.email}. It works for 7 days.
            </>
          ) : (
            <>The login was created but the email did not go out. Use “Resend invitation” below.</>
          )}
        </div>
      )}
      <div className="grid gap-3">
        <input name="name" required placeholder="Full name" className="input" />
        <input name="email" type="email" required placeholder="Email" className="input" />
        <input name="phone" type="tel" inputMode="tel" placeholder="Mobile (optional)" className="input" />
        <input name="company" required placeholder="Company, e.g. Trisol" className="input" />
      </div>
      <SubmitButton pendingText="Sending…" className="btn-ghost w-full">
        Send invitation
      </SubmitButton>
    </form>
  );
}
