'use client';
import { useActionState } from 'react';
import { CopyField } from '@/components/copy-field';
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
        <div className="space-y-2 rounded-xl bg-emerald-50/60 p-3 text-sm ring-1 ring-emerald-100">
          <div>
            <b>{state.done.name}</b> can sign in as {state.done.email}. One-time password (shown once):
          </div>
          <CopyField value={state.done.tempPassword} label="One-time password" />
        </div>
      )}
      <div className="grid gap-3">
        <input name="name" required placeholder="Full name" className="input" />
        <input name="email" type="email" required placeholder="Email" className="input" />
        <input name="company" required placeholder="Company, e.g. Trisol" className="input" />
      </div>
      <SubmitButton pendingText="Adding…" className="btn-ghost w-full">
        Add partner login
      </SubmitButton>
    </form>
  );
}
