'use client';
import { useActionState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { type InviteState, invite } from './team-actions';

export function InviteForm({ roles }: { roles: { key: string; label: string; hint: string }[] }) {
  const [state, action] = useActionState<InviteState, FormData>(invite, {});
  return (
    <form action={action} className="space-y-3">
      {state.error && (
        <div className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200">{state.error}</div>
      )}
      {state.done && (
        <div
          className={`rounded-xl p-3 text-sm ring-1 ${state.done.emailed ? 'bg-emerald-50/60 text-emerald-900 ring-emerald-100' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}
        >
          {state.done.added ? (
            <>
              <b>{state.done.name}</b> already has a Lango login, so they were added straight away
              {state.done.emailed ? ' and told by email.' : '. The email to tell them did not go out.'}
            </>
          ) : state.done.emailed ? (
            <>
              Invitation sent to <b>{state.done.name}</b> at {state.done.email}. The link works for 7 days.
            </>
          ) : (
            <>The invitation was created but the email did not go out. Use “Resend” on their row.</>
          )}
        </div>
      )}
      <input name="name" required maxLength={80} placeholder="Enter full name" className="input" />
      <input name="email" type="email" required placeholder="Enter email address" className="input" />
      <input name="phone" type="tel" inputMode="tel" placeholder="Enter mobile number (optional)" className="input" />
      <fieldset className="space-y-1.5">
        <legend className="label mb-1.5">Role</legend>
        {roles.map((r) => (
          <label
            key={r.key}
            className="flex cursor-pointer items-start gap-2.5 rounded-xl p-2.5 ring-1 ring-ink-100 has-[:checked]:bg-ink-50 has-[:checked]:ring-ink-900"
          >
            <input
              type="radio"
              name="role"
              value={r.key}
              defaultChecked={r.key === 'reception'}
              className="mt-0.5 accent-ink-900"
            />
            <span>
              <span className="block text-sm font-medium">{r.label}</span>
              <span className="block text-xs text-ink-500">{r.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <SubmitButton pendingText="Sending…" className="btn-primary w-full">
        Send invitation
      </SubmitButton>
    </form>
  );
}
