'use client';
import { useActionState } from 'react';
import { CopyField } from '@/components/copy-field';
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
        <div className="space-y-2 rounded-xl bg-emerald-50/60 p-3 text-sm ring-1 ring-emerald-100">
          <div>
            <b>{state.done.name}</b> can now sign in as {state.done.email}. Give them this one-time password:
          </div>
          <CopyField value={state.done.tempPassword} label="One-time password" />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <input name="name" required placeholder="Full name" className="input" />
        <input name="email" type="email" required placeholder="Email" className="input" />
        <select name="role" defaultValue="reception" className="input">
          <option value="reception">Reception</option>
          <option value="manager">Manager</option>
          <option value="accountant">Accountant</option>
          <option value="owner">Owner</option>
        </select>
      </div>
      <SubmitButton pendingText="Adding…" className="btn-ghost w-full">
        Add team member
      </SubmitButton>
    </form>
  );
}
